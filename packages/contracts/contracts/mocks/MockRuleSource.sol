// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Test double. Stands in for both the rule stock and the processor so the tender contract can be
/// tested without TapeOut: against a rule circuit that misbehaves in every way a call can, or against
/// a real rule's truth table served from storage. Never deployed to mainnet.
contract MockRuleSource {
    uint8 public constant GOOD = 0;
    uint8 public constant REVERTS = 1;
    uint8 public constant TWO_BYTES = 2;
    uint8 public constant SIX_BITS = 3;
    uint8 public constant BURNS_GAS = 4;
    uint8 public constant RAW_WORD = 5;
    uint8 public constant EMPTY = 6;
    uint8 public constant TABLE = 7;

    uint8 public mode;
    /// The 5-bit result returned in GOOD mode.
    uint8 public word;
    /// One output byte per 11-bit input, used in TABLE mode.
    bytes private _table;

    function set(uint8 mode_, uint8 word_) external {
        mode = mode_;
        word = word_;
    }

    /// Serve a rule's complete truth table (2,048 bytes), exactly as its circuit would.
    function setTable(bytes calldata table) external {
        require(table.length == 2048, "table size");
        _table = table;
        mode = TABLE;
    }

    function isRule(uint256) external pure returns (bool) {
        return true;
    }

    function circuits() external view returns (address) {
        return address(this);
    }

    function eval(uint256, bytes calldata inputs) external view returns (bytes memory) {
        if (mode == REVERTS) revert("broken circuit");
        if (mode == TWO_BYTES) return hex"0102";
        if (mode == SIX_BITS) return abi.encodePacked(uint8(32));
        if (mode == BURNS_GAS) {
            uint256 i = 0;
            while (true) i++;
        }
        if (mode == RAW_WORD) {
            // Not ABI-encoded bytes at all: a bare 32-byte word.
            assembly {
                mstore(0, 31)
                return(0, 32)
            }
        }
        if (mode == EMPTY) return "";
        if (mode == TABLE) {
            uint256 input = uint256(uint8(inputs[0])) | (uint256(uint8(inputs[1])) << 8);
            return abi.encodePacked(_table[input]);
        }
        return abi.encodePacked(word);
    }
}
