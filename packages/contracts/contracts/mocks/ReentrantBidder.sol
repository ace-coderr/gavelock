// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGavelockMoney {
    function submitBid(uint256 id, bytes32 commitment, bytes calldata ciphertext) external payable returns (uint256);
    function challenge(uint256 id, uint256 bidIndex, uint8 kind, string calldata reason) external payable returns (uint256);
    function claimDeposit(uint256 id, uint256 index) external;
    function claimBond(uint256 id, uint256 index) external;
    function withdrawFees() external;
}

/// Test attacker. A bidder that, when it is paid, tries to re-enter every money function.
contract ReentrantBidder {
    IGavelockMoney public immutable target;
    uint256 public tenderId;
    uint256 public index;
    uint256 public attempts;
    uint256 public reentriesThatWorked;
    /// When set, the contract refuses to be paid at all.
    bool public refuse;

    function setRefuse(bool v) external {
        refuse = v;
    }

    constructor(address target_) {
        target = IGavelockMoney(target_);
    }

    function bid(uint256 id, bytes32 commitment) external payable {
        tenderId = id;
        index = target.submitBid{value: msg.value}(id, commitment, hex"01");
    }

    function fileChallenge(uint256 id, uint256 bidIndex) external payable {
        tenderId = id;
        index = target.challenge{value: msg.value}(id, bidIndex, 0, "attacker");
    }

    function collectDeposit() external {
        target.claimDeposit(tenderId, index);
    }

    function collectBond() external {
        target.claimBond(tenderId, index);
    }

    receive() external payable {
        require(!refuse, "refused");
        attempts++;
        try target.claimDeposit(tenderId, index) { reentriesThatWorked++; } catch {}
        try target.claimBond(tenderId, index) { reentriesThatWorked++; } catch {}
        try target.withdrawFees() { reentriesThatWorked++; } catch {}
    }
}
