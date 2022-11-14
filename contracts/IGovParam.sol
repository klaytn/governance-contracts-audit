// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev Interface of the GovParam Contract
 */
interface IGovParam {
    struct Param {
        uint256 activation;
        bool exists;
        bytes val;
    }

    event SetParam(string name, bool exists, bytes value, uint256 activation);

    function paramNames(uint256 idx) external view returns (string memory);

    function getAllParamNames() external view returns (string[] memory);

    function checkpoints(string calldata name)
        external
        view
        returns (Param[] memory);

    function getAllCheckpoints()
        external
        view
        returns (string[] memory, Param[][] memory);

    function getParam(string calldata name)
        external
        view
        returns (bool, bytes memory);

    function getParamAt(string calldata name, uint256 blockNumber)
        external
        view
        returns (bool, bytes memory);

    function getAllParams()
        external
        view
        returns (string[] memory, bytes[] memory);

    function getAllParamsAt(uint256 blockNumber)
        external
        view
        returns (string[] memory, bytes[] memory);

    function setParam(
        string calldata name, bool exists, bytes calldata value,
        uint256 activation) external;

    function setParamIn(
        string calldata name, bool exists, bytes calldata value,
        uint256 relativeActivation) external;
}
