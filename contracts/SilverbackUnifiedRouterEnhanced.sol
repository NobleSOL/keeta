
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces.sol";
import "./SilverbackV2Pair.sol";
import "./SilverbackV2Factory.sol";
import "./SilverbackV2Library.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint) external;
}

contract SilverbackUnifiedRouter {
    struct SwapParams {
        address inToken;
        address outToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address to;
        address target;
        bytes data;
        uint256 deadline;
        bool sweep;
    }

    struct PermitData {
        address token; uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s;
    }

    address public immutable feeRecipient;
    uint16 public feeBps;
    address public owner;

    ISilverbackV2Factory public immutable v2Factory;
    address public immutable WETH;

    uint16 public constant MAX_FEE_BPS = 1000;
    address public constant NATIVE = address(0);

    event OwnerChanged(address newOwner);
    event FeeUpdated(uint16 newFeeBps);
    event SwapForwarded(address indexed user, address inToken, address outToken, uint amountIn, uint fee, address target);

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

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnerChanged(_owner);
    }

    function setFeeBps(uint16 _bps) external onlyOwner {
        require(_bps <= MAX_FEE_BPS, "FEE");
        feeBps = _bps;
        emit FeeUpdated(_bps);
    }

    receive() external payable {}

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

    // ========== External Swap Forwarding ==========
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

    // Additional swap, liquidity, and fee-on-transfer logic will go here (next block)

    // ========== Multihop Swaps and Fee-on-Transfer Support ==========
    function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external checkDeadline(deadline) returns (uint[] memory amounts)
    {
        require(path.length >= 2, "PATH");
        uint fee = (amountIn * feeBps) / 10_000;
        uint amt = amountIn - fee;
        if (fee > 0) _safeTransferFrom(path[0], msg.sender, feeRecipient, fee);
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amt);
        amounts = SilverbackV2Library.getAmountsOut(address(v2Factory), amt, path);
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = _pairFor(input, output);
            (address token0,) = SilverbackV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address toAddr = i < path.length - 2 ? _pairFor(output, path[i + 2]) : to;
            SilverbackV2Pair(pair).swap(amount0Out, amount1Out, toAddr);
        }
        require(amounts[amounts.length - 1] >= amountOutMin, "MIN_OUT");
    }

    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external payable checkDeadline(deadline) returns (uint[] memory amounts)
    {
        require(path[0] == WETH, "INVALID_PATH");
        uint fee = (msg.value * feeBps) / 10_000;
        uint value = msg.value - fee;
        if (fee > 0) payable(feeRecipient).transfer(fee);
        IWETH(WETH).deposit{value: value}();
        _safeTransfer(WETH, _pairFor(path[0], path[1]), value);
        amounts = SilverbackV2Library.getAmountsOut(address(v2Factory), value, path);
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = _pairFor(input, output);
            (address token0,) = SilverbackV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address toAddr = i < path.length - 2 ? _pairFor(output, path[i + 2]) : to;
            SilverbackV2Pair(pair).swap(amount0Out, amount1Out, toAddr);
        }
        require(amounts[amounts.length - 1] >= amountOutMin, "MIN_OUT");
    }

    function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external checkDeadline(deadline) returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WETH, "INVALID_PATH");
        uint fee = (amountIn * feeBps) / 10_000;
        uint amt = amountIn - fee;
        if (fee > 0) _safeTransferFrom(path[0], msg.sender, feeRecipient, fee);
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amt);
        amounts = SilverbackV2Library.getAmountsOut(address(v2Factory), amt, path);
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = _pairFor(input, output);
            (address token0,) = SilverbackV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address toAddr = i < path.length - 2 ? _pairFor(output, path[i + 2]) : address(this);
            SilverbackV2Pair(pair).swap(amount0Out, amount1Out, toAddr);
        }
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
        require(amounts[amounts.length - 1] >= amountOutMin, "MIN_OUT");
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        pair = v2Factory.getPair(tokenA, tokenB);
        require(pair != address(0), "PAIR");
    }
}
