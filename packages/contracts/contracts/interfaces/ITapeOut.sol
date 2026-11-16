// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// The parts of TapeOut on X Layer that Gavelock calls. Every signature here was checked against
/// the live contracts on 16 November 2026 (docs/PROTOCOL.md, section 3).

/// Processor factory.
interface ITapeOutFactory {
    /// Creates a processor. Pulls `deployFee()` of the fee token from the caller by allowance; takes no OKB.
    function createCPU(
        string calldata name,
        string calldata symbol,
        string calldata story,
        uint256 transistorSupply,
        uint256 mintPrice
    ) external returns (address transistors, address circuits);

    function deployFee() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function bem() external view returns (address);
    function cpuCount() external view returns (uint256);
    function cpuAt(uint256 index) external view returns (address circuits);
    function isCPU(address circuits) external view returns (bool);
}

/// A processor's transistors (ERC-1155). Token id 0 is NAND, 1 is LATCH.
interface ITapeOutTransistors {
    /// Mints to the caller. Pulls `amount * mintPrice() + protocolFee()` of the fee token by allowance.
    function mint(uint256 id, uint256 amount) external;

    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
    function creator() external view returns (address);
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// A processor's circuits (ERC-721): "the processor". Each token is a taped-out netlist.
interface ITapeOutCircuits {
    /// Stores a netlist and mints it to the caller. `msg.value` must equal `TAPEOUT_FEE()` exactly.
    /// Burns one NAND transistor per NAND record from the caller.
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);

    /// Evaluates a combinational circuit. Inputs and outputs are bit-packed, least significant bit first.
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory outputs);

    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    /// The last id assigned (the number of circuits), not the next one.
    function nextId() external view returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);
    function ownerOf(uint256 id) external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
}

/// The beacon every processor's circuits contract reads its code from.
interface ITapeOutBeacon {
    function implementation() external view returns (address);
    function owner() external view returns (address);
}
