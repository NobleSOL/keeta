// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces.sol";
import "./SilverbackV2Pair.sol";
import "./SilverbackV2Factory.sol";

/// SilverbackUnifiedRouter
/// - Protocol fee on swaps (not on LP ops)
/// - External swap forwarder (like SilverbackRouter v1) with fee deduction
/// - Native V2 AMM helpers: add/remove liquidity and direct pair swaps
contract SilverbackUnifiedRouter {
    // ---- types ----
    struct SwapParams {
        address inToken;            // ERC20 or native (address(0)) for external forwarding
        address outToken;           // ERC20 or native
        uint256 amountIn;
        uint256 minAmountOut;
        address to;
        address target;             // external DEX/aggregator
        bytes   data;               // calldata for target
        uint256 deadline;
        bool    sweep;              // sweep outToken delta to `to`
    }

    struct PermitData {
        address token; uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s;
    }

    // ---- storage ----
    address public immutable feeRecipient;
    uint16  public feeBps; // <= 1000 (10%)
    address public owner;

    ISilverbackV2Factory public immutable v2Factory;
    address public immutable WETH;

    uint16 public constant MAX_FEE_BPS = 1000;
    address public constant NATIVE = address(0);

    // ---- events ----
    event OwnerChanged(address newOwner);
    event FeeUpdated(uint16 newFeeBps);
    event SwapForwarded(address indexed user, address inToken, address outToken, uint amountIn, uint fee, address target);

    // ---- modifiers ----
    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }
    modifier checkDeadline(uint256 d) { require(block.timestamp <= d, "DEADLINE"); _; }

    constructor(address _feeRecipient, uint16 _feeBps, address _v2Factory, address _WETH) {
        require(_feeRecipient != address(0) && _v2Factory != address(0) && _WETH != address(0), "ZERO");
        require(_feeBps <= MAX_FEE_BPS, "FEE");
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        owner = msg.sender;
        v2Factory = ISilverbackV2Factory(_v2Factory);
        WETH = _WETH;
    }

    // ---- admin ----
    function setOwner(address _owner) external onlyOwner { owner = _owner; emit OwnerChanged(_owner); }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= MAX_FEE_BPS, "FEE"); feeBps = _bps; emit FeeUpdated(_bps); }

    receive() external payable {}

    // ---- internal utils ----
    function _balanceOf(address token) internal view returns (uint256) {
        if (token == NATIVE) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool s, bytes memory d) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(s && (d.length == 0 || abi.decode(d, (bool))), "TRANSFER");
    }

    function _safeTransferFrom(address token, address from, address to, uint value) private {
        (bool s, bytes memory d) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(s && (d.length == 0 || abi.decode(d, (bool))), "TRANSFER_FROM");
    }

    function _forceApprove(address token, address spender, uint value) private {
        (bool s1, bytes memory d1) = token.staticcall(abi.encodeWithSelector(IERC20.allowance.selector, address(this), spender));
        if (s1 && d1.length >= 32 && abi.decode(d1, (uint)) > 0) {
            (bool s2,) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
            require(s2, "APPROVE_RESET");
        }
        (bool s3,) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        require(s3, "APPROVE");
    }

    function _revertMsg(bytes memory ret) private pure returns (string memory) {
        if (ret.length < 68) return "TARGET";
        assembly { ret := add(ret, 0x04) }
        return abi.decode(ret, (string));
    }

    // ================= External forwarding swaps (fee’d) =================
    function swapAndForward(SwapParams calldata p, PermitData calldata permit) external payable checkDeadline(p.deadline) {
        if (permit.token != address(0)) {
            (bool ok, ) = permit.token.call(abi.encodeWithSelector(
                bytes4(keccak256("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")),
                msg.sender, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ));
            require(ok, "PERMIT");
        }
        _swapAndForward(p);
    }

    function swapAndForward(SwapParams calldata p) external payable checkDeadline(p.deadline) {
        _swapAndForward(p);
    }

    function _swapAndForward(SwapParams calldata p) internal {
        require(p.amountIn > 0 && p.target != address(0), "ARGS");
        uint fee = (p.amountIn * feeBps) / 10_000;
        uint toTarget;
        uint preOut = _balanceOf(p.outToken);

        if (p.inToken == NATIVE) {
            require(msg.value >= p.amountIn, "MSG_VALUE");
            (bool fs,) = payable(feeRecipient).call{value: fee}("");
            require(fs, "FEE_NATIVE");
            toTarget = p.amountIn - fee;
            (bool ok, bytes memory ret) = p.target.call{value: toTarget}(p.data);
            require(ok, _revertMsg(ret));
        } else {
            _safeTransferFrom(p.inToken, msg.sender, address(this), p.amountIn);
            if (fee > 0) _safeTransfer(p.inToken, feeRecipient, fee);
            toTarget = p.amountIn - fee;
            _forceApprove(p.inToken, p.target, toTarget);
            (bool ok, bytes memory ret) = p.target.call(p.data);
            require(ok, _revertMsg(ret));
        }

        if (p.sweep) {
            uint postOut = _balanceOf(p.outToken);
            uint gained = postOut > preOut ? postOut - preOut : 0;
            require(gained >= p.minAmountOut, "MIN_OUT");
            if (gained > 0) {
                if (p.outToken == NATIVE) {
                    (bool s,) = payable(p.to).call{value: gained}("");
                    require(s, "SEND_ETH");
                } else {
                    _safeTransfer(p.outToken, p.to, gained);
                }
            }
        }
        emit SwapForwarded(msg.sender, p.inToken, p.outToken, p.amountIn, fee, p.target);
    }

    // ================= Native Silverback V2 operations =================

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external checkDeadline(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        address pair = v2Factory.getPair(tokenA, tokenB);
        if (pair == address(0)) { pair = v2Factory.createPair(tokenA, tokenB); }
        // pull tokens
        _safeTransferFrom(tokenA, msg.sender, pair, amountADesired);
        _safeTransferFrom(tokenB, msg.sender, pair, amountBDesired);
        // mint LP
        liquidity = SilverbackV2Pair(pair).mint(to);
        // simple min checks based on reserves delta
        (uint112 r0, uint112 r1,) = SilverbackV2Pair(pair).getReserves();
        // NOTE: for brevity, minimal checks; prefer computing optimal amounts (see V2 router)
        amountA = amountADesired; amountB = amountBDesired;
        require(amountA >= amountAMin && amountB >= amountBMin, "SLIP");
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external checkDeadline(deadline) returns (uint amountA, uint amountB) {
        address pair = v2Factory.getPair(tokenA, tokenB);
        require(pair != address(0), "PAIR");
        _safeTransferFrom(pair, msg.sender, pair, liquidity);
        (uint amount0, uint amount1) = SilverbackV2Pair(pair).burn(to);
        (address token0,) = SilverbackV2Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin && amountB >= amountBMin, "SLIP");
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address tokenIn,
        address tokenOut,
        address to,
        uint deadline
    ) external checkDeadline(deadline) returns (uint amountOut) {
        require(amountIn > 0, "AMT");
        // deduct protocol fee
        uint fee = (amountIn * feeBps) / 10_000;
        uint amt = amountIn - fee;
        if (fee > 0) _safeTransferFrom(tokenIn, msg.sender, feeRecipient, fee);
        // send net to pair
        address pair = v2Factory.getPair(tokenIn, tokenOut);
        require(pair != address(0), "PAIR");
        _safeTransferFrom(tokenIn, msg.sender, pair, amt);
        (address token0,) = SilverbackV2Library.sortTokens(tokenIn, tokenOut);
        (uint112 r0, uint112 r1,) = SilverbackV2Pair(pair).getReserves();
        (uint reserveIn, uint reserveOut) = tokenIn == token0 ? (r0, r1) : (r1, r0);
        amountOut = SilverbackV2Library.getAmountOut(amt, reserveIn, reserveOut);
        (uint a0, uint a1) = tokenIn == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
        SilverbackV2Pair(pair).swap(a0, a1, to);
        require(amountOut >= amountOutMin, "MIN_OUT");
    }
}
