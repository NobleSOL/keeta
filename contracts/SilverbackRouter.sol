// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * SilverbackRouter
 * - Deducts protocol fee in basis points to a fixed recipient
 * - Forwards calldata to specified DEX/aggregator (Uniswap/Aerodrome/OpenOcean, etc.)
 * - Supports native ETH and ERC20 inputs
 * - Sweeps any received output tokens/ETH to the specified recipient
 * - Includes simple UniswapV2-style add/remove liquidity helpers
 */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        require(token.transfer(to, value), "TRANSFER_FAIL");
    }
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        require(token.transferFrom(from, to, value), "TRANSFER_FROM_FAIL");
    }
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        // Some tokens require setting to 0 first
        (, bytes memory data) = address(token).staticcall(abi.encodeWithSelector(token.allowance.selector, address(this), spender));
        if (data.length >= 32 && abi.decode(data, (uint256)) > 0) {
            require(token.approve(spender, 0), "APPROVE_RESET_FAIL");
        }
        require(token.approve(spender, value), "APPROVE_FAIL");
    }
}

interface IUniswapV2Factory {
    function getPair(address, address) external view returns (address);
}

interface IUniswapV2Router {
    function factory() external view returns (address);
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);

    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountToken, uint amountETH);
}

error DeadlineExpired();
error AmountTooSmall();
error InvalidTarget();

contract SilverbackRouter {
    using SafeERC20 for IERC20;

    address public immutable feeRecipient; // Silverback protocol fee receiver
    uint16 public feeBps; // in basis points, max 1000 = 10%
    address public owner;

    uint16 public constant MAX_FEE_BPS = 1000; // 10%
    address public constant NATIVE = address(0);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    event OwnerChanged(address indexed newOwner);
    event FeeUpdated(uint16 feeBps);
    event SwapForwarded(address indexed user, address inToken, address outToken, uint256 amountIn, uint256 fee, address target);

    constructor(address _feeRecipient, uint16 _feeBps) {
        require(_feeRecipient != address(0), "BAD_RECIP");
        require(_feeBps <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        owner = msg.sender;
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnerChanged(_owner);
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    receive() external payable {}

    struct SwapParams {
        address inToken;            // ERC20 or NATIVE (address(0))
        address outToken;           // ERC20 or NATIVE
        uint256 amountIn;           // user input amount
        uint256 minAmountOut;       // slippage limit
        address to;                 // recipient of output
        address target;             // DEX/aggregator to call
        bytes   data;               // calldata for target (constructed off-chain)
        uint256 deadline;           // unix time deadline
        bool    sweep;              // sweep any leftovers to 'to'
    }

    // Optional EIP-2612 permit to pull ERC20 without prior approve
    struct PermitData {
        address token;
        uint256 value;
        uint256 deadline;
        uint8   v; bytes32 r; bytes32 s;
    }

    function _balanceOf(address token) internal view returns (uint256) {
        if (token == NATIVE) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function swapAndForward(SwapParams calldata p, PermitData calldata permit) external payable checkDeadline(p.deadline) {
        // Apply permit if provided
        if (permit.token != address(0)) {
            IERC20Permit(permit.token).permit(msg.sender, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s);
        }
        _swapAndForwardInternal(p);
    }

    function swapAndForward(SwapParams calldata p) external payable checkDeadline(p.deadline) {
        _swapAndForwardInternal(p);
    }

    function _swapAndForwardInternal(SwapParams calldata p) internal {
        if (p.amountIn == 0) revert AmountTooSmall();
        if (p.target == address(0)) revert InvalidTarget();

        uint256 fee;
        uint256 toTargetValue;
        uint256 preOut = _balanceOf(p.outToken);

        if (p.inToken == NATIVE) {
            require(msg.value >= p.amountIn, "INSUFFICIENT_MSG_VALUE");
            fee = (p.amountIn * feeBps) / 10_000;
            (bool fs, ) = payable(feeRecipient).call{value: fee}("");
            require(fs, "FEE_SEND_FAIL");
            toTargetValue = p.amountIn - fee;
            (bool ok, bytes memory ret) = p.target.call{value: toTargetValue}(p.data);
            require(ok, _revertMsg(ret));
        } else {
            IERC20 inTok = IERC20(p.inToken);
            // pull from user
            inTok.safeTransferFrom(msg.sender, address(this), p.amountIn);
            fee = (p.amountIn * feeBps) / 10_000;
            if (fee > 0) inTok.safeTransfer(feeRecipient, fee);
            uint256 amountToTarget = p.amountIn - fee;
            SafeERC20.forceApprove(inTok, p.target, amountToTarget);
            (bool ok, bytes memory ret) = p.target.call(p.data);
            require(ok, _revertMsg(ret));
        }

        // Sweep outToken to recipient
        if (p.sweep) {
            uint256 postOut = _balanceOf(p.outToken);
            uint256 gained;
            if (postOut > preOut) {
                gained = postOut - preOut;
            }
            require(gained >= p.minAmountOut, "SLIPPAGE_EXCEEDED");
            if (gained > 0) {
                if (p.outToken == NATIVE) {
                    (bool s, ) = payable(p.to).call{value: gained}("");
                    require(s, "SEND_NATIVE_FAIL");
                } else {
                    IERC20(p.outToken).safeTransfer(p.to, gained);
                }
            }
        }

        emit SwapForwarded(msg.sender, p.inToken, p.outToken, p.amountIn, fee, p.target);
    }

    // =========== UniswapV2-style Liquidity helpers (no protocol fee) ==========

    function addLiquidityV2(
        address router,
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external checkDeadline(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);
        SafeERC20.forceApprove(IERC20(tokenA), router, amountADesired);
        SafeERC20.forceApprove(IERC20(tokenB), router, amountBDesired);
        (amountA, amountB, liquidity) = IUniswapV2Router(router).addLiquidity(
            tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline
        );
    }

    function addLiquidityV2ETH(
        address router,
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable checkDeadline(deadline) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountTokenDesired);
        SafeERC20.forceApprove(IERC20(token), router, amountTokenDesired);
        (amountToken, amountETH, liquidity) = IUniswapV2Router(router).addLiquidityETH{value: msg.value}(
            token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline
        );
        // refund dust ETH if any
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool s, ) = payable(msg.sender).call{value: bal}("");
            require(s, "REFUND_FAIL");
        }
    }

    function removeLiquidityV2(
        address router,
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external checkDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        // The router will transferFrom(msg.sender) LP tokens; so we must be msg.sender = this contract.
        // Transfer LP from user to this contract, then approve router.
        address pair = IUniswapV2Factory(IUniswapV2Router(router).factory()).getPair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        SafeERC20.forceApprove(IERC20(pair), router, liquidity);
        (amountA, amountB) = IUniswapV2Router(router).removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }

    function removeLiquidityV2ETH(
        address router,
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external checkDeadline(deadline) returns (uint256 amountToken, uint256 amountETH) {
        address pair = IUniswapV2Factory(IUniswapV2Router(router).factory()).getPair(token, address(0));
        // NOTE: for ETH pairs, factories/wrapped tokens may vary; pass the correct WETH pair address when calling.
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        SafeERC20.forceApprove(IERC20(pair), router, liquidity);
        (amountToken, amountETH) = IUniswapV2Router(router).removeLiquidityETH(token, liquidity, amountTokenMin, amountETHMin, to, deadline);
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool s, ) = payable(msg.sender).call{value: bal}("");
            require(s, "REFUND_FAIL");
        }
    }

    // Admin rescue
    function sweep(address token, address to) external onlyOwner {
        uint256 bal = _balanceOf(token);
        if (token == NATIVE) {
            (bool s, ) = payable(to).call{value: bal}("");
            require(s, "SWEEP_NATIVE_FAIL");
        } else {
            IERC20(token).safeTransfer(to, bal);
        }
    }

    function _revertMsg(bytes memory ret) private pure returns (string memory) {
        if (ret.length < 68) return "TARGET_REVERTED";
        assembly {
            ret := add(ret, 0x04)
        }
        return abi.decode(ret, (string));
    }
}
