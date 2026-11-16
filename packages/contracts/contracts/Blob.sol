// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Bytes kept on chain as the code of a tiny contract. Cheaper than storage for anything longer than a
/// few words, immutable once written, and readable by any contract or with eth_getCode.
/// The stored code starts with a STOP byte so the data can never be executed.
library Blob {
    /// Largest blob: the EVM's contract size limit minus the STOP byte.
    uint256 internal constant MAX = 24575;

    error BlobTooLarge();
    error BlobStoreFailed();

    function put(bytes memory data) internal returns (address pointer) {
        if (data.length > MAX) revert BlobTooLarge();
        // 61 size | 80 | 60 0a | 3d | 39 | 3d | f3 : copy the bytes after this 10-byte prefix and return them as code
        bytes memory creation = abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df3", hex"00", data);
        assembly {
            pointer := create(0, add(creation, 32), mload(creation))
        }
        if (pointer == address(0)) revert BlobStoreFailed();
    }

    function size(address pointer) internal view returns (uint256) {
        uint256 length = pointer.code.length;
        return length == 0 ? 0 : length - 1;
    }

    function get(address pointer) internal view returns (bytes memory data) {
        uint256 length = size(pointer);
        data = new bytes(length);
        assembly {
            extcodecopy(pointer, add(data, 32), 1, length)
        }
    }
}
