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

import "./IStakingTracker.sol";

contract StakingTracker is IStakingTracker {

    struct Tracker {
        // Tracked block range.
        // Balance changes are only updated if trackStart <= block.number < trackEnd.
        uint256 trackStart;
        uint256 trackEnd;

        // List of eligible nodes and their staking addresses.
        // Determined at crateTracker() and does not change.
        address[] nodeIds;
        mapping(address => address) rewardToNodeId;
        mapping(address => address) stakingToNodeId;

        // Balances and voting powers.
        // First collected at crateTracker() and updated at notifyStake() until trackEnd.
        mapping(address => uint256) stakingBalances; // staking address balances
        mapping(address => uint256) nodeBalances; // consolidated node balances
        mapping(address => uint256) nodeVotes; // node voting powers
        uint256 totalVotes;
        uint256 eligibleNodes;
    }

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // Contract owner
    address public owner;

    // Store tracker objects
    mapping(uint256 => Tracker) private trackers; // indexed by trackerId
    uint256[] private allTrackerIds;  // append-only list of trackerIds
    uint256[] private liveTrackerIds; // trackerIds with block.number < trackEnd. Not in order.

    // 1-to-1 mapping between nodeId and voter account
    mapping(address => address) private nodeIdToVoter;
    mapping(address => address) private voterToNodeId;

    // Constants
    function CONTRACT_TYPE()
        external view virtual override returns(string memory) { return "StakingTracker"; }
    function VERSION()
        external view virtual override returns(uint256) { return 1; }
    function ADDRESS_BOOK_ADDRESS()
        public view virtual override returns(address) { return 0x0000000000000000000000000000000000000400; }
    function MIN_STAKE()
        public view virtual override returns(uint256) { return 5000000 ether; }

    // Modifiers

    modifier onlyOwner() {
        require(owner == msg.sender, "Caller is not the owner");
        _;
    }

    // Mutators

    /// @dev Construct the contract with initial values
    constructor(address _owner) {
        owner = _owner;
    }

    /// @dev Transfer ownership to other address
    /// Only allowed to the contract owner.
    function transferOwnership(address newOwner) external virtual onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @dev Creates a new Tracker and populate initial values from AddressBook
    /// Only allowed to the contract owner.
    function createTracker(uint256 trackStart, uint256 trackEnd)
        external override onlyOwner returns(uint256 trackerId)
    {
        trackerId = getLastTrackerId() + 1;
        allTrackerIds.push(trackerId);
        liveTrackerIds.push(trackerId);

        Tracker storage tracker = trackers[trackerId];
        tracker.trackStart = trackStart;
        tracker.trackEnd = trackEnd;

        populateFromAddressBook(trackerId);
        calcAllVotes(trackerId);

        return trackerId;
    }

    /// @dev Populate a tracker with staking balances from AddressBook
    function populateFromAddressBook(uint256 trackerId) private {
        Tracker storage tracker = trackers[trackerId];

        (address[] memory nodeIds,
         address[] memory stakingContracts,
         address[] memory rewardAddrs) = getAddressBookLists();

        // Consolidate staking contracts (grouped by reward address)
        for (uint256 i = 0; i < nodeIds.length; i++) {
            address n = nodeIds[i];
            address s = stakingContracts[i];
            address r = rewardAddrs[i];
            if (tracker.rewardToNodeId[r] == address(0)) { // fresh rewardAddr
                tracker.nodeIds.push(n);
                tracker.rewardToNodeId[r] = n;

                tracker.stakingToNodeId[s] = n;
                tracker.stakingBalances[s] = s.balance;
                tracker.nodeBalances[n] = s.balance;
            } else { // previously appeared rewardAddr
                n = tracker.rewardToNodeId[r]; // use representative nodeId

                tracker.stakingToNodeId[s] = n;
                tracker.stakingBalances[s] = s.balance;
                tracker.nodeBalances[n] += s.balance;
            }
        }
    }

    /// @dev Populate a tracker with voting powers
    function calcAllVotes(uint256 trackerId) private {
        Tracker storage tracker = trackers[trackerId];
        tracker.totalVotes = 0;
        tracker.eligibleNodes = 0;

        for (uint256 i = 0; i < tracker.nodeIds.length; i++) {
            if (isNodeEligible(trackerId, tracker.nodeIds[i])) {
                tracker.eligibleNodes ++;
            }
        }
        for (uint256 i = 0; i < tracker.nodeIds.length; i++) {
            address nodeId = tracker.nodeIds[i];
            uint256 votes = calcVotes(tracker.eligibleNodes, tracker.nodeBalances[nodeId]);
            tracker.nodeVotes[nodeId] = votes;
            tracker.totalVotes += votes;
        }
    }

    /// @dev Re-evaluate Tracker contents related to the staking contract
    /// Anyone can call this function, but `staking` must be a staking contract
    /// registered in tracker.
    function refreshStake(address staking) external override {
        uint256 i = 0;
        while (i < liveTrackerIds.length) {
            uint256 currId = liveTrackerIds[i];

            // Remove expired tracker as soon as we discover it
            if (!isTrackerLive(currId)) {
                uint256 lastId = liveTrackerIds[liveTrackerIds.length-1];
                liveTrackerIds[i] = lastId;
                liveTrackerIds.pop();
                emit RetireTracker(currId);
                continue;
            }

            updateTracker(currId, staking);
            i++;
        }
    }

    /// @dev Re-evalute node balance and subsequently voting power
    function updateTracker(uint256 trackerId, address staking) private {
        Tracker storage tracker = trackers[trackerId];

        // Resolve node
        address nodeId = tracker.stakingToNodeId[staking];
        if (nodeId == address(0)) {
            return;
        }

        // Update balance
        uint256 oldBalance = tracker.stakingBalances[staking];
        uint256 newBalance = address(staking).balance;
        tracker.stakingBalances[staking] = newBalance;
        tracker.nodeBalances[nodeId] -= oldBalance;
        tracker.nodeBalances[nodeId] += newBalance;
        uint256 nodeBalance = tracker.nodeBalances[nodeId];

        // Update votes
        uint256 oldVotes = tracker.nodeVotes[nodeId];
        uint256 newVotes = calcVotes(tracker.eligibleNodes, nodeBalance);
        tracker.nodeVotes[nodeId] = newVotes;
        tracker.totalVotes -= oldVotes;
        tracker.totalVotes += newVotes;

        emit RefreshStake(trackerId, nodeId, staking,
                          newBalance, nodeBalance, newVotes, tracker.totalVotes);
    }

    /// @dev Re-evaluate voter account mapping related to the staking contract
    /// Anyone can call this function, but `staking` must be a staking contract
    /// registered to the current AddressBook.
    ///
    /// Updates the voter account of the node of the `staking` with respect to
    /// the corrent AddressBook.
    ///
    /// If the node already had a voter account, the account will be unregistered.
    /// If the new voter account is already appointed for another node,
    /// this function reverts.
    function refreshVoter(address staking) external override {
        address nodeId = resolveStakingFromAddressBook(staking);
        require(nodeId != address(0), "not a staking contract");
        require(ICnStakingV2(staking).VERSION() >= 2, "Invalid CnStaking contract");

        // Unlink existing two-way mapping
        address oldVoter = nodeIdToVoter[nodeId];
        if (oldVoter != address(0)) {
            voterToNodeId[oldVoter] = address(0);
            nodeIdToVoter[nodeId] = address(0);
        }

        // Create new mapping
        address newVoter = ICnStakingV2(staking).getVoterAddress();
        if (newVoter != address(0)) {
            require(voterToNodeId[newVoter] == address(0), "Voter address already taken");
            voterToNodeId[newVoter] = nodeId;
            nodeIdToVoter[nodeId] = newVoter;
        }

        emit RefreshVoter(nodeId, staking, newVoter);
    }

    /// @dev Resolve nodeId of given `staking` contract with respect to the current AddressBook
    /// Returns null if given `staking` is not a registered staking contract.
    function resolveStakingFromAddressBook(address staking) private view returns(address) {
        (address[] memory nodeIds,
         address[] memory stakingContracts,
         address[] memory rewardAddrs) = getAddressBookLists();

        address rewardAddr;
        for (uint256 i = 0; i < nodeIds.length; i++) {
            if (stakingContracts[i] == staking) {
                rewardAddr = rewardAddrs[i];
                break;
            }
        }
        for (uint256 i = 0; i < nodeIds.length; i++) {
            if (rewardAddrs[i] == rewardAddr) {
                return nodeIds[i];
            }
        }
        return address(0);
    }

    // Helper fucntions

    /// @dev Query the 3-tuples (node, staking, reward) from AddressBook
    function getAddressBookLists() private view returns(
        address[] memory nodeIds,
        address[] memory stakingContracts,
        address[] memory rewardAddrs)
    {
        (nodeIds, stakingContracts, rewardAddrs, /* kgf */, /* kir */) =
            IAddressBook(ADDRESS_BOOK_ADDRESS()).getAllAddressInfo();
        require(nodeIds.length == stakingContracts.length &&
                nodeIds.length == rewardAddrs.length, "Invalid data");
    }

    /// @dev Determine if a node is eligible for voting with respect to given tracker.
    /// A node is eligible if it has staked at least MIN_STAKE().
    function isNodeEligible(uint256 trackerId, address nodeId) private view returns(bool) {
        Tracker storage tracker = trackers[trackerId];
        return tracker.nodeBalances[nodeId] >= MIN_STAKE();
    }

    /// @dev Calculate voting power from staking amounts.
    /// One integer vote is granted for each MIN_STAKE() balance. But the number of votes
    /// is at most ([number of eligible nodes] - 1).
    function calcVotes(uint256 eligibleNodes, uint256 balance) private view returns(uint256) {
        uint256 voteCap = 1;
        if (eligibleNodes > 1) {
            voteCap = eligibleNodes - 1;
        }

        uint256 votes = balance / MIN_STAKE();
        if (votes > voteCap) {
            votes = voteCap;
        }
        return votes;
    }

    /// @dev Determine if given tracker is updatable with respect to current block.
    function isTrackerLive(uint256 trackerId) private view returns(bool) {
        Tracker storage tracker = trackers[trackerId];
        return (tracker.trackStart <= block.number && block.number < tracker.trackEnd);
    }

    // Getter functions

    function getLastTrackerId() public view override returns(uint256) {
        return allTrackerIds.length;
    }
    function getAllTrackerIds() external view override returns(uint256[] memory) {
        return allTrackerIds;
    }
    function getLiveTrackerIds() external view override returns(uint256[] memory) {
        return liveTrackerIds;
    }

    function getTrackerSummary(uint256 trackerId) external view override returns(
        uint256 trackStart,
        uint256 trackEnd,
        uint256 numNodes,
        uint256 totalVotes,
        uint256 eligibleNodes)
    {
        Tracker storage tracker = trackers[trackerId];
        trackStart = tracker.trackStart;
        trackEnd = tracker.trackEnd;
        numNodes = tracker.nodeIds.length;
        totalVotes = tracker.totalVotes;
        eligibleNodes = tracker.eligibleNodes;
    }

    function getTrackedNode(uint256 trackerId, address nodeId) external view override returns(
        uint256 nodeBalance,
        uint256 nodeVotes)
    {
        Tracker storage tracker = trackers[trackerId];
        nodeBalance = tracker.nodeBalances[nodeId];
        nodeVotes = tracker.nodeVotes[nodeId];
    }

    function getAllTrackedNodes(uint256 trackerId) external view override returns(
        address[] memory nodeIds,
        uint256[] memory nodeBalances,
        uint256[] memory nodeVotes)
    {
        Tracker storage tracker = trackers[trackerId];
        uint256 numNodes = tracker.nodeIds.length;
        nodeIds = tracker.nodeIds;

        nodeBalances = new uint256[](numNodes);
        nodeVotes = new uint256[](numNodes);
        for (uint256 i = 0; i < numNodes; i++) {
            address nodeId = tracker.nodeIds[i];
            nodeBalances[i] = tracker.nodeBalances[nodeId];
            nodeVotes[i] = tracker.nodeVotes[nodeId];
        }
    }

    function getNodeFromStaking(uint256 trackerId, address staking)
        external view override returns(address) {
        Tracker storage tracker = trackers[trackerId];
        return tracker.stakingToNodeId[staking];
    }
    function getNodeFromVoter(address voter)
        external view override returns(address) {
        return voterToNodeId[voter];
    }
    function getVoterFromNode(address nodeId)
        external view override returns(address) {
        return nodeIdToVoter[nodeId];
    }
}

interface IAddressBook {
    function getAllAddressInfo() external view returns(
        address[] memory, address[] memory, address[] memory, address, address);
}

interface ICnStakingV2 {
    function getVoterAddress() external view returns(address);
    function VERSION() external view returns(uint256);
}
