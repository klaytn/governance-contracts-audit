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

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IStakingTracker.sol";

contract StakingTracker is IStakingTracker, Ownable {

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
        // First collected at crateTracker() and updated at refreshStake() until trackEnd.
        mapping(address => uint256) stakingBalances; // staking address balances
        mapping(address => uint256) nodeBalances; // consolidated node balances
        mapping(address => uint256) nodeVotes; // node voting powers
        uint256 totalVotes;
        uint256 eligibleNodes;
    }

    // Store tracker objects
    mapping(uint256 => Tracker) private trackers; // indexed by trackerId
    uint256[] private allTrackerIds;  // append-only list of trackerIds
    uint256[] private liveTrackerIds; // trackerIds with block.number < trackEnd. Not in order.

    // 1-to-1 mapping between nodeId and voter account
    mapping(address => address) public override nodeIdToVoter;
    mapping(address => address) public override voterToNodeId;

    // Constants
    function CONTRACT_TYPE()
        external view virtual override returns(string memory) { return "StakingTracker"; }
    function VERSION()
        external view virtual override returns(uint256) { return 1; }
    function ADDRESS_BOOK_ADDRESS()
        public view virtual override returns(address) { return 0x0000000000000000000000000000000000000400; }
    function MIN_STAKE()
        public view virtual override returns(uint256) { return 5000000 ether; }

    // Mutators

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

        emit CreateTracker(trackerId, trackStart, trackEnd, tracker.nodeIds);
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
            uint256 balance = getStakingBalance(s);

            if (tracker.rewardToNodeId[r] == address(0)) { // fresh rewardAddr
                tracker.nodeIds.push(n);
                tracker.rewardToNodeId[r] = n;

                tracker.stakingToNodeId[s] = n;
                tracker.stakingBalances[s] = balance;
                tracker.nodeBalances[n] = balance;
            } else { // previously appeared rewardAddr
                n = tracker.rewardToNodeId[r]; // use representative nodeId

                tracker.stakingToNodeId[s] = n;
                tracker.stakingBalances[s] = balance;
                tracker.nodeBalances[n] += balance;
            }
        }
    }

    /// @dev Populate a tracker with voting powers
    function calcAllVotes(uint256 trackerId) private {
        Tracker storage tracker = trackers[trackerId];
        uint256 eligibleNodes = 0;
        uint256 totalVotes = 0;

        for (uint256 i = 0; i < tracker.nodeIds.length; i++) {
            address nodeId = tracker.nodeIds[i];
            if (tracker.nodeBalances[nodeId] >= MIN_STAKE()) {
                eligibleNodes ++;
            }
        }
        for (uint256 i = 0; i < tracker.nodeIds.length; i++) {
            address nodeId = tracker.nodeIds[i];
            uint256 votes = calcVotes(eligibleNodes, tracker.nodeBalances[nodeId]);
            tracker.nodeVotes[nodeId] = votes;
            totalVotes += votes;
        }

        tracker.eligibleNodes = eligibleNodes;
        tracker.totalVotes = totalVotes; // only write final result to save gas
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
        uint256 newBalance = getStakingBalance(staking);
        tracker.stakingBalances[staking] = newBalance;
        tracker.nodeBalances[nodeId] -= oldBalance;
        tracker.nodeBalances[nodeId] += newBalance;
        uint256 nodeBalance = tracker.nodeBalances[nodeId];

        // Update vote cap if necessary
        bool wasEligible = oldBalance >= MIN_STAKE();
        bool isEligible = newBalance >= MIN_STAKE();
        if (wasEligible != isEligible) {
            if (wasEligible) { // eligible -> not eligible
                tracker.eligibleNodes -= 1;
            } else { // not eligible -> eligible
                tracker.eligibleNodes += 1;
            }
            recalcAllVotes(trackerId);
        }

        // Update votes
        uint256 oldVotes = tracker.nodeVotes[nodeId];
        uint256 newVotes = calcVotes(tracker.eligibleNodes, nodeBalance);
        tracker.nodeVotes[nodeId] = newVotes;
        tracker.totalVotes -= oldVotes;
        tracker.totalVotes += newVotes;

        emit RefreshStake(trackerId, nodeId, staking,
                          newBalance, nodeBalance, newVotes, tracker.totalVotes);
    }

    /// @dev Recalculate votes of all nodes
    function recalcAllVotes(uint256 trackerId) internal {
        Tracker storage tracker = trackers[trackerId];

        uint256 totalVotes = tracker.totalVotes;
        for (uint256 i = 0; i < tracker.nodeIds.length; i++) {
            address nodeId = tracker.nodeIds[i];
            uint256 nodeBalance = tracker.nodeBalances[nodeId];
            uint256 oldVotes = tracker.nodeVotes[nodeId];
            uint256 newVotes = calcVotes(tracker.eligibleNodes, nodeBalance);

            if (oldVotes != newVotes) {
                tracker.nodeVotes[nodeId] = newVotes;
                totalVotes -= oldVotes;
                totalVotes += newVotes;
            }
        }
        tracker.totalVotes = totalVotes; // only write final result to save gas
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
        require(nodeId != address(0), "Not a staking contract");
        require(isCnStakingV2(staking), "Invalid CnStaking contract");

        // Unlink existing two-way mapping
        address oldVoter = nodeIdToVoter[nodeId];
        if (oldVoter != address(0)) {
            voterToNodeId[oldVoter] = address(0);
            nodeIdToVoter[nodeId] = address(0);
        }

        // Create new mapping
        address newVoter = ICnStakingV2(staking).voterAddress();
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

    /// @dev Test if the given contract is a CnStakingV2 instance
    /// Does not check if the contract is registered in AddressBook.
    function isCnStakingV2(address staking) public view returns(bool) {
        bool ok;
        bytes memory out;

        (ok, out) = staking.staticcall(abi.encodeWithSignature("CONTRACT_TYPE()"));
        if (!ok || out.length == 0) {
            return false;
        }
        string memory _type = abi.decode(out, (string));
        if (keccak256(bytes(_type)) != keccak256(bytes("CnStakingContract"))) {
            return false;
        }

        (ok, out) = staking.staticcall(abi.encodeWithSignature("VERSION()"));
        if (!ok || out.length == 0) {
            return false;
        }
        uint256 _version = abi.decode(out, (uint256));
        if (_version < 2) {
            return false;
        }

        return true;
    }

    /// @dev Effective balance of a CnStakingV2 contract.
    /// The effective balance is the contract account balance except unstaking amount.
    function getStakingBalance(address staking) public view virtual returns(uint256) {
        if (isCnStakingV2(staking)) {
            uint256 accountBalance = staking.balance;
            uint256 unstaking = ICnStakingV2(staking).unstaking();
            return (accountBalance - unstaking);
        }
        return 0;
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
        return (tracker.trackStart,
                tracker.trackEnd,
                tracker.nodeIds.length,
                tracker.totalVotes,
                tracker.eligibleNodes);
    }

    function getTrackedNode(uint256 trackerId, address nodeId) external view override returns(
        uint256 nodeBalance,
        uint256 nodeVotes)
    {
        Tracker storage tracker = trackers[trackerId];
        return (tracker.nodeBalances[nodeId],
                tracker.nodeVotes[nodeId]);
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
        return (nodeIds, nodeBalances, nodeVotes);
    }

    function stakingToNodeId(uint256 trackerId, address staking)
        external view override returns(address)
    {
        Tracker storage tracker = trackers[trackerId];
        return tracker.stakingToNodeId[staking];
    }
}

interface IAddressBook {
    function getAllAddressInfo() external view returns(
        address[] memory, address[] memory, address[] memory, address, address);
}

interface ICnStakingV2 {
    function voterAddress() external view returns(address);
    function unstaking() external view returns(uint256);
}
