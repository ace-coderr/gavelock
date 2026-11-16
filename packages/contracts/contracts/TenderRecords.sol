// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Blob} from "./Blob.sol";

interface ITenderGate {
    function gateOf(uint256 id) external view returns (address buyer, uint64 clarificationsStart, uint64 biddingStart, bool cancelled);
}

/// @title TenderRecords
/// @notice The documents and clarifications of Gavelock tenders. Append-only: nothing written here can
/// be edited or removed, and nothing can be written once a tender's bidding has started. That moment is
/// read from the tender contract, so the freeze is enforced by the chain and not by the buyer.
///
/// Every document is stored as contract code with its SHA-256 computed on chain from the stored bytes.
/// Questions and answers are stored the same way. Each record carries the block it was written in.
/// No owner, no upgrade path.
contract TenderRecords {
    uint256 public constant TEXT_MAX = 2048;
    /// Largest document, in bytes.
    uint256 public constant DOCUMENT_MAX = 1 << 20;
    /// Most document versions one tender can have.
    uint256 public constant DOCUMENTS_MAX = 64;
    uint256 public constant NAME_MAX = 128;
    uint256 public constant CONTENT_TYPE_MAX = 64;

    ITenderGate public immutable tenders;

    struct Document {
        bytes32 sha256Hash;
        uint32 size;
        uint32 received;
        /// Block of the chunk that completed the document; 0 while it is still being uploaded.
        uint64 completedBlock;
        string name;
        string contentType;
        address[] chunks;
    }

    struct Question {
        address asker;
        uint64 askedBlock;
        address text;
        uint64 answeredBlock;
        address answer;
    }

    mapping(uint256 => Document[]) private _documents;
    mapping(uint256 => Question[]) private _questions;

    event DocumentPublished(uint256 indexed tenderId, uint256 indexed index, bytes32 sha256Hash, uint32 size);
    event Asked(uint256 indexed tenderId, uint256 indexed index, address indexed asker);
    event Answered(uint256 indexed tenderId, uint256 indexed index);

    error NotBuyer();
    error Frozen();
    error NotOpenYet();
    error NoSuchRecord();
    error AlreadyDone();
    error BadLength();
    error TooManyDocuments();
    error HashMismatch();

    constructor(address tenders_) {
        require(tenders_ != address(0), "zero address");
        tenders = ITenderGate(tenders_);
    }

    // ------------------------------------------------------------------ documents

    /// @notice Post a document version. Send the whole file, or its first chunk and the rest with
    /// appendDocument. A document counts only once every byte has arrived and the SHA-256 of the stored
    /// bytes equals `sha256Hash`; the transaction delivering the last chunk reverts otherwise.
    function publishDocument(uint256 id, string calldata name, string calldata contentType, bytes32 sha256Hash, uint32 size, bytes calldata chunk)
        external
        returns (uint256 index)
    {
        _onlyBuyerBeforeBidding(id);
        Document[] storage docs = _documents[id];
        if (docs.length >= DOCUMENTS_MAX) revert TooManyDocuments();
        if (size == 0 || size > DOCUMENT_MAX) revert BadLength();
        if (bytes(name).length == 0 || bytes(name).length > NAME_MAX || bytes(contentType).length > CONTENT_TYPE_MAX) revert BadLength();
        index = docs.length;
        Document storage d = docs.push();
        d.sha256Hash = sha256Hash;
        d.size = size;
        d.name = name;
        d.contentType = contentType;
        _appendChunk(id, index, d, chunk);
    }

    function appendDocument(uint256 id, uint256 index, bytes calldata chunk) external {
        _onlyBuyerBeforeBidding(id);
        Document[] storage docs = _documents[id];
        if (index >= docs.length) revert NoSuchRecord();
        Document storage d = docs[index];
        if (d.completedBlock != 0) revert AlreadyDone();
        _appendChunk(id, index, d, chunk);
    }

    function _appendChunk(uint256 id, uint256 index, Document storage d, bytes calldata chunk) private {
        uint256 received = d.received + chunk.length;
        if (chunk.length == 0 || received > d.size) revert BadLength();
        d.chunks.push(Blob.put(chunk));
        d.received = uint32(received);
        if (received < d.size) return;

        // Complete: hash exactly what was stored, not what was sent.
        bytes memory whole = new bytes(received);
        uint256 offset = 0;
        uint256 count = d.chunks.length;
        for (uint256 i = 0; i < count; i++) {
            address pointer = d.chunks[i];
            uint256 length = Blob.size(pointer);
            assembly {
                extcodecopy(pointer, add(add(whole, 32), offset), 1, length)
            }
            offset += length;
        }
        if (sha256(whole) != d.sha256Hash) revert HashMismatch();
        d.completedBlock = uint64(block.number);
        emit DocumentPublished(id, index, d.sha256Hash, d.size);
    }

    // ------------------------------------------------------------------ clarifications

    /// @notice Ask the buyer a question. Anyone may ask, from the start of clarifications until bidding starts.
    function ask(uint256 id, string calldata text) external returns (uint256 index) {
        (, uint64 clarificationsStart, uint64 biddingStart, bool cancelled) = tenders.gateOf(id);
        if (cancelled || block.timestamp >= biddingStart) revert Frozen();
        if (block.timestamp < clarificationsStart) revert NotOpenYet();
        index = _questions[id].length;
        _questions[id].push(Question(msg.sender, uint64(block.number), _text(text), 0, address(0)));
        emit Asked(id, index, msg.sender);
    }

    /// @notice The buyer's answer. One per question, and only before bidding starts, so every bidder sees it.
    function answer(uint256 id, uint256 index, string calldata text) external {
        _onlyBuyerBeforeBidding(id);
        if (index >= _questions[id].length) revert NoSuchRecord();
        Question storage q = _questions[id][index];
        if (q.answeredBlock != 0) revert AlreadyDone();
        q.answer = _text(text);
        q.answeredBlock = uint64(block.number);
        emit Answered(id, index);
    }

    function _onlyBuyerBeforeBidding(uint256 id) private view {
        (address buyer, , uint64 biddingStart, bool cancelled) = tenders.gateOf(id);
        if (msg.sender != buyer) revert NotBuyer();
        if (cancelled || block.timestamp >= biddingStart) revert Frozen();
    }

    function _text(string calldata text) private returns (address) {
        if (bytes(text).length == 0 || bytes(text).length > TEXT_MAX) revert BadLength();
        return Blob.put(bytes(text));
    }

    // ------------------------------------------------------------------ views

    function documentCount(uint256 id) external view returns (uint256) {
        return _documents[id].length;
    }

    function getDocument(uint256 id, uint256 index) external view returns (Document memory) {
        if (index >= _documents[id].length) revert NoSuchRecord();
        return _documents[id][index];
    }

    function questionCount(uint256 id) external view returns (uint256) {
        return _questions[id].length;
    }

    function getQuestion(uint256 id, uint256 index) external view returns (Question memory) {
        if (index >= _questions[id].length) revert NoSuchRecord();
        return _questions[id][index];
    }

    /// @notice Read a document chunk, a question or an answer stored by this contract.
    function read(address pointer) external view returns (bytes memory) {
        return Blob.get(pointer);
    }
}
