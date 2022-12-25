// Copyright 2022 The klaytn Authors
// This file is part of the klaytn library.
//
// The klaytn library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The klaytn library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the klaytn library. If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

interface IStakingTracker {
    // Events
    event CreateTracker(uint256 indexed trackerId,
                        uint256 trackStart, uint256 trackEnd, address[] nodeIds);
    event RetireTracker(uint256 indexed trackerId);
    event RefreshStake(uint256 indexed trackerId, address indexed nodeId, address staking,
                       uint256 stakingBalance, uint256 nodeBalance, uint256 nodeVote,
                       uint256 totalVotes);
    event RefreshVoter(address indexed nodeId, address staking, address voter);

    // Constants
    function CONTRACT_TYPE() external view returns(string memory);
    function VERSION() external view returns(uint256);
    function ADDRESS_BOOK_ADDRESS() external view returns(address);
    function MIN_STAKE() external view returns(uint256);

    // Mutators
    function createTracker(uint256 trackStart, uint256 trackEnd) external returns(uint256 trackerId);
    function refreshStake(address staking) external;
    function refreshVoter(address staking) external;

    // Getters
    function getLastTrackerId() external view returns(uint256);
    function getAllTrackerIds() external view returns(uint256[] memory);
    function getLiveTrackerIds() external view returns(uint256[] memory);

    function getTrackerSummary(uint256 trackerId) external view returns(
        uint256 trackStart,
        uint256 trackEnd,
        uint256 numNodes,
        uint256 totalVotes,
        uint256 eligibleNodes);
    function getTrackedNode(uint256 trackerId, address nodeId) external view returns(
        uint256 nodeBalance,
        uint256 nodeVotes);
    function getAllTrackedNodes(uint256 trackerId) external view returns(
        address[] memory nodeIds,
        uint256[] memory nodeBalances,
        uint256[] memory nodeVotes);

    function stakingToNodeId(uint256 trackerId, address staking) external view returns(
        address nodeId);
    function voterToNodeId(address voter) external view returns(address nodeId);
    function nodeIdToVoter(address nodeId) external view returns(address voter);
}
