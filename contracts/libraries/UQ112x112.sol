// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Fixed point 112x112 math, compatible with Uniswap V2 TWAP logic
library UQ112x112 {
    uint224 internal constant Q112 = 2**112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112; // never overflows
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}
