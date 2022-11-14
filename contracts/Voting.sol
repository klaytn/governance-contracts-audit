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

import "./IVoting.sol";

contract Voting is IVoting {
    // Types

    struct Proposal {
        // Contents
        address proposer;
        string description;
        address[] targets; // Transaction 'to' addresses
        uint256[] values;  // Transaction 'value' amounts
        bytes[] calldatas; // Transaction 'input' data

        // Schedule
        uint256 voteStart;     // propose()d block + votingDelay
        uint256 voteEnd;       // voteStart + votingPeriod
        uint256 queueDeadline; // voteEnd + queueTimeout
        uint256 eta;           // queue()d block + execDelay
        uint256 execDeadline;  // queue()d block + execDelay + execTimeout
        bool canceled;         // true if successfully cancel()ed
        bool queued;           // true if successfully queue()d
        bool executed;         // true if successfully execute()d

        // Vote counting
        uint256 trackerId;
        uint256 totalYes;
        uint256 totalNo;
        uint256 totalAbstain;
        address[] voters;
        mapping(address => Receipt) receipts;
    }

    // States

    mapping(uint256 => Proposal) private proposals;
    uint256 public nextProposalId;

    /// @dev The address of StakingTracker
    address public stakingTracker;

    /// @dev The address of secretariat
    /// Secretariat has the permission to propose, queue, and execute proposals.
    /// If the secretariat is empty, any eligible voter at the time of the submission
    /// can propose proposals. Also, any eligible voter of a proposal can queue
    /// and execute the proposals.
    address public override secretariat;

    constructor(address _tracker, address _secretariat) {
        nextProposalId = 1;
        stakingTracker = _tracker;
        secretariat = _secretariat;
    }

    /// @dev The given proposal must exist
    function checkProposal(uint256 proposalId) internal view {
        require(proposals[proposalId].proposer != address(0), "No such proposal");
    }

    /// @dev Check for propose, queue and execute permission
    /// If secretariat is appointed, the sender must be the secretariat.
    /// Otherwise, the sender must be an eligible voter.
    function checkPermission(uint256 proposalId) internal view {
        if (secretariat != address(0)) {
            require(msg.sender == secretariat, "Not the secretariat");
        } else {
            (address nodeId, uint256 votes) = getVotes(proposalId, msg.sender);
            require(nodeId != address(0), "Not a registered voter");
            require(votes > 0, "Not eligible to vote");
        }
    }

    /// @dev The given proposal must be in the speciefied state
    modifier proposalAt(uint256 proposalId, ProposalState s) {
        checkProposal(proposalId);
        require(state(proposalId) == s, "Not allowed in current state");
        _;
    }

    /// @dev Sender must have execution right to the given proposal
    modifier onlyExecutor(uint256 proposalId) {
        checkProposal(proposalId);
        checkPermission(proposalId);
        _;
    }

    /// @dev Sender must be the proposer of the given proposal
    modifier onlyProposerOf(uint256 proposalId) {
        checkProposal(proposalId);
        require(proposals[proposalId].proposer == msg.sender, "Not the proposer");
        _;
    }

    /// @dev Sender must be this contract, i.e. executed via governance proposal
    modifier onlyGovernance() {
        require(address(this) == msg.sender, "Not a governance transaction");
        _;
    }

    // Mutators

    /// @dev Create a Proposal
    /// If secretariat is null, any GC with at least 1 vote can propose.
    /// Otherwise only secretariat can propose.
    /// Default timing parameters are used.
    function propose(
        string memory description,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas) external override returns (uint256 proposalId) {

        require(targets.length == values.length &&
                targets.length == calldatas.length, "Invalid actions");

        proposalId = nextProposalId;
        nextProposalId ++;
        Proposal storage p = proposals[proposalId];

        p.proposer = msg.sender;
        p.description = description;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;

        p.voteStart = block.number + votingDelay();
        p.voteEnd = p.voteStart + votingPeriod();
        p.queueDeadline = p.voteEnd + queueTimeout();

        // Finalize voter list and track balance changes during the preparation period
        p.trackerId = IStakingTracker(stakingTracker).createTracker(
            block.number, p.voteStart);

        // Permission check must be done here since it requires trackerId.
        checkPermission(proposalId);

        emit ProposalCreated(proposalId, p.proposer,
                             p.targets, p.values, new string[](p.targets.length), p.calldatas,
                             0, 0, p.description);
    }

    /// @dev Cancel a proposal
    /// The proposal must be in one of Pending, Active, Passed, or Queued state.
    /// Only the proposer of the proposal can cancel the proposal.
    function cancel(uint256 proposalId) external override
    onlyProposerOf(proposalId) {
        Proposal storage p = proposals[proposalId];

        ProposalState s = state(proposalId);
        require(s == ProposalState.Pending ||
                s == ProposalState.Active ||
                s == ProposalState.Passed ||
                s == ProposalState.Queued,
                "Not allowed in current state");

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /// @dev Cast a vote to a proposal
    /// The proposal must be in Active state
    /// A same voter can call this function again to change choice.
    /// choice must be one of VoteChoice.
    function castVote(uint256 proposalId, uint8 choice) external override
    proposalAt(proposalId, ProposalState.Active) {
        Proposal storage p = proposals[proposalId];

        (address nodeId, uint256 votes) = getVotes(proposalId, msg.sender);
        require(nodeId != address(0), "Not a registered voter");
        require(votes > 0, "Not eligible to vote");

        require(choice == uint8(VoteChoice.Yes) ||
                choice == uint8(VoteChoice.No) ||
                choice == uint8(VoteChoice.Abstain), "Not a valid choice");

        if (p.receipts[nodeId].hasVoted) {
            // Changing vote; undo tally
            uint8 oldChoice = p.receipts[nodeId].choice;
            uint256 oldVotes = p.receipts[nodeId].votes;
            decrementTally(proposalId, oldChoice, oldVotes);
        } else {
            // First time voting for this proposal
            p.voters.push(nodeId);
        }
        // Record new vote
        p.receipts[nodeId].hasVoted = true;
        p.receipts[nodeId].choice = choice;
        p.receipts[nodeId].votes = votes;
        incrementTally(proposalId, choice, votes);

        emit VoteCast(nodeId, proposalId, choice, votes, "");
    }

    function incrementTally(uint256 proposalId, uint8 choice, uint256 votes) private {
        Proposal storage p = proposals[proposalId];
        if (choice == uint8(VoteChoice.Yes)) {
            p.totalYes += votes;
        } else if (choice == uint8(VoteChoice.No)) {
            p.totalNo += votes;
        } else if (choice == uint8(VoteChoice.Abstain)) {
            p.totalAbstain += votes;
        }
    }

    function decrementTally(uint256 proposalId, uint8 choice, uint256 votes) private {
        Proposal storage p = proposals[proposalId];
        if (choice == uint8(VoteChoice.Yes)) {
            p.totalYes -= votes;
        } else if (choice == uint8(VoteChoice.No)) {
            p.totalNo -= votes;
        } else if (choice == uint8(VoteChoice.Abstain)) {
            p.totalAbstain -= votes;
        }
    }

    /// @dev Queue a passed proposal
    /// The proposal must be in Passed state
    /// Current block must be before `queueDeadline` of this proposal
    /// If secretariat is null, any GC with at least 1 vote can queue.
    /// Otherwise only secretariat can queue.
    function queue(uint256 proposalId) external override
    proposalAt(proposalId, ProposalState.Passed)
    onlyExecutor(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(p.targets.length > 0, "Proposal has no action");

        p.eta = block.number + execDelay();
        p.execDeadline = p.eta + execTimeout();
        p.queued = true;

        emit ProposalQueued(proposalId, p.eta);
    }

    /// @dev Execute a queued proposal
    /// The proposal must be in Queued state
    /// Current block must be after `eta` and before `execDeadline` of this proposal
    /// If secretariat is null, any GC with at least 1 vote can execute.
    /// Otherwise only secretariat can execute.
    function execute(uint256 proposalId) external payable override
    proposalAt(proposalId, ProposalState.Queued)
    onlyExecutor(proposalId) {
        Proposal storage p = proposals[proposalId];

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success, bytes memory result) =
                    p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            handleCallResult(success, result);
        }

        p.executed = true;

        emit ProposalExecuted(proposalId);
    }

    function handleCallResult(bool success, bytes memory result) private pure {
        if (success) {
            return;
        }

        if (result.length == 0) {
            // Call failed without message.
            revert("Transaction failed");
        } else {
            // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.7.3/contracts/utils/Address.sol
            // Toss the result, which would contain error instances.
            assembly {
                let result_size := mload(result)
                revert(add(32, result), result_size)
            }
        }
    }

    /// @dev Set secretariat account
    /// Must be called by address(this), i.e. via governance proposal.
    function updateSecretariat(address newAddr) public override onlyGovernance {
        address oldAddr = secretariat;
        secretariat = newAddr;
        emit UpdateSecretariat(oldAddr, newAddr);
    }

    // Getters

    /// @dev Delay from proposal submission to voting start in block numbers
    function votingDelay() public pure virtual override returns(uint256) { return 604800; }

    /// @dev Duration of the voting in block numbers
    function votingPeriod() public pure virtual override returns(uint256) { return 604800; }

    /// @dev Grace period to queue() passed proposals in block numbers
    function queueTimeout() public pure virtual override returns(uint256) { return 604800; }

    /// @dev A minimum delay before a queued transaction can be executed in block numbers
    function execDelay() public pure virtual override returns(uint256) { return 172800; }

    /// @dev Grace period to execute() queued proposals since `execDelay` in block numbers
    function execTimeout() public pure virtual override returns(uint256) { return 604800; }

    /// @dev The id of the last created proposal
    /// Retrurns 0 if there is no proposal.
    function lastProposalId() external view override returns(uint256) {
        return nextProposalId - 1;
    }

    /// @dev State of a proposal
    function state(uint256 proposalId) public view override returns(ProposalState) {
        Proposal storage p = proposals[proposalId];

        if (p.executed) {
            return ProposalState.Executed;
        } else if (p.canceled) {
            return ProposalState.Canceled;
        } else if (block.number < p.voteStart) {
            return ProposalState.Pending;
        } else if (block.number <= p.voteEnd) {
            return ProposalState.Active;
        } else if (!checkQuorum(proposalId)) {
            return ProposalState.Failed;
        }

        if (!p.queued) {
            if (block.number <= p.queueDeadline) {
                return ProposalState.Passed;
            } else {
                return ProposalState.Expired;
            }
        } else {
            if (block.number <= p.execDeadline) {
                return ProposalState.Queued;
            } else {
                return ProposalState.Expired;
            }
        }
    }

    /// @dev Check if a proposal is passed
    /// Note that its return value represents the current voting status,
    /// and is subject to change until the voting ends.
    function checkQuorum(uint256 proposalId) public view override returns(bool) {
        // TODO: check quorum
        Proposal storage p = proposals[proposalId];
        return p.totalYes > 0;
    }

    /// @dev Resolve the voter account into its nodeId and voting powers
    /// Returns the currently assigned nodeId. Returns the voting powers
    /// effective at the given proposal. Returns zero nodeId and 0 votes
    /// if the voter account is not assigned to any eligible node.
    ///
    /// @param proposalId  The proposal id
    /// @return nodeId  The nodeId assigned to this voter account
    /// @return votes   The amount of voting powers the voter account represents
    function getVotes(uint256 proposalId, address voter) public view override returns(
        address nodeId, uint256 votes) {
        Proposal storage p = proposals[proposalId];

        nodeId = IStakingTracker(stakingTracker).getNodeFromVoter(voter);
        ( , votes) = IStakingTracker(stakingTracker).getTrackedNode(p.trackerId, nodeId);
    }

    /// @dev General contents of a proposal
    function getProposalContent(uint256 proposalId) external override view returns(
        uint256 id,
        address proposer,
        string memory description)
    {
        Proposal storage p = proposals[proposalId];
        return (proposalId,
                p.proposer,
                p.description);
    }

    /// @dev Transactions in a proposal
    /// signatures is Array of empty strings; for compatibility with OpenZeppelin
    function getActions(uint256 proposalId) external override view returns(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas)
    {
        Proposal storage p = proposals[proposalId];
        return (p.targets,
                p.values,
                new string[](p.targets.length),
                p.calldatas);
    }

    /// @dev Timing and state related properties of a proposal
    function getProposalSchedule(uint256 proposalId) external view override returns(
        uint256 voteStart,
        uint256 voteEnd,
        uint256 queueDeadline,
        uint256 eta,
        uint256 execDeadline,
        bool canceled,
        bool queued,
        bool executed)
    {
        Proposal storage p = proposals[proposalId];
        return (p.voteStart,
                p.voteEnd,
                p.queueDeadline,
                p.eta,
                p.execDeadline,
                p.canceled,
                p.queued,
                p.executed);
    }

    /// @dev Vote counting related properties of a proposal
    function getProposalTally(uint256 proposalId) external view override returns(
        uint256 totalYes,
        uint256 totalNo,
        uint256 totalAbstain,
        uint256 quorumCount,
        uint256 quorumPower,
        address[] memory voters)
    {
        Proposal storage p = proposals[proposalId];
        return (p.totalYes,
                p.totalNo,
                p.totalAbstain,
                0,
                0,
                p.voters);
    }

    /// @dev Individual vote receipt
    function getReceipt(uint256 proposalId, address nodeId)
        external view override returns(Receipt memory)
    {
        Proposal storage p = proposals[proposalId];
        return p.receipts[nodeId];
    }
}

interface IStakingTracker {
    // Balance changes are only updated if trackStart <= block.number < trackEnd.
    function createTracker(uint256 trackStart, uint256 trackEnd) external returns(uint256 trackerId);

    function getTrackerSummary(uint256 trackerId) external view returns(
        uint256 trackStart,
        uint256 trackEnd,
        uint256 numNodes,
        uint256 totalVotes,
        uint256 eligibleNodes);
    function getTrackedNode(uint256 trackerId, address nodeId) external view returns(
        uint256 nodeBalance,
        uint256 nodeVotes);
    function getNodeFromVoter(address voter) external view returns(address nodeId);
}
