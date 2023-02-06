const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowBlock, toPeb, expectRevert, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("init", function() {

    describe("constructor", function() {
      it("success", async function() {
        let vo = await E.deploy();
      });
      it("auto-deploy StakingTracker", async function() {
        let vo = await E.Voting.deploy(NULL_ADDR, E.secr1.address);

        // StakingTracker is auto-deployed
        let stAddr = await vo.stakingTracker();
        expect(stAddr).to.not.equal(NULL_ADDR);

        // The owner is the Voting
        let st = await E.StakingTracker.attach(stAddr);
        expect(await st.owner()).to.equal(vo.address);
      });
      it("reject null secretary", async function() {
        await expectRevert(E.Voting.deploy(NULL_ADDR, NULL_ADDR),
          "No propose access");
      });
    }); // constructor

    describe("constants", function() {
      it("success", async function() {
        // contribute to the code coverage of the original contract
        let Voting = await ethers.getContractFactory("Voting");
        let vo = await Voting.deploy(E.conf1cn.stAddr, E.secr1.address);
        expect(await vo.queueTimeout()).to.equal(604800);
        expect(await vo.execDelay()).to.equal(172800);
        expect(await vo.execTimeout()).to.equal(604800);
      });
    }); // constants
  }); // init

  describe("propose", function() {
    let vo;
    before(async function() {
      vo = await E.deploy();
    });

    it("success zero actions", async function() {
      await E.must_propose(vo, E.secr1,
        { targets: [], values: [], calldatas: [] })
    });
    it("success one action", async function() {
      await E.must_propose(vo, E.secr1);
    });
    it("success two actions", async function() {
      let targets = [E.secr1.address, E.other1.address];
      let values = [toPeb(0), toPeb(2)];
      let calldatas = ["0xd0e30db0", "0x"];
      await E.must_propose(vo, E.secr1, { targets, values, calldatas });
    });
    it("custom timing", async function() {
      let votingDelay = 123456;
      let votingPeriod = 234567;

      let pid = await E.must_propose(vo, E.secr1, { votingDelay, votingPeriod });
      let proposeBlock = await nowBlock();

      let schedule = await vo.getProposalSchedule(pid);
      expect(schedule[0]).to.equal(proposeBlock + votingDelay); // voteStart
      expect(schedule[1]).to.equal(proposeBlock + votingDelay + votingPeriod); // voteEnd
    });
    it("reject invalid actions", async function() {
      // Note: default args have 1 action; setting something [] makes the actions invalid.
      await E.revert_propose(vo, E.secr1, { targets: [] }, "Invalid actions");
      await E.revert_propose(vo, E.secr1, { values: [] }, "Invalid actions");
      await E.revert_propose(vo, E.secr1, { calldatas: [] }, "Invalid actions");
    });
    it("reject invalid custom timing", async function() {
      let DAY = 86400;
      let rule = [3*DAY, 7*DAY, 10*DAY, 20*DAY];

      await E.must_updateTimingRule(vo, E.secr1, rule);
      // exactly min
      await E.must_propose(vo, E.secr1, { votingDelay: 3*DAY, votingPeriod: 10*DAY });
      // exactly max
      await E.must_propose(vo, E.secr1, { votingDelay: 7*DAY, votingPeriod: 20*DAY });
      // out of range
      await E.revert_propose(vo, E.secr1, { votingDelay: 1*DAY, votingPeriod: 14*DAY }, "Invalid votingDelay");
      await E.revert_propose(vo, E.secr1, { votingDelay: 9*DAY, votingPeriod: 14*DAY }, "Invalid votingDelay");
      await E.revert_propose(vo, E.secr1, { votingDelay: 5*DAY, votingPeriod: 7*DAY },  "Invalid votingPeriod");
      await E.revert_propose(vo, E.secr1, { votingDelay: 5*DAY, votingPeriod: 28*DAY }, "Invalid votingPeriod");
    });
  }); // propose

  describe("proposal getters", async function() {
    let vo, pid;
    before(async function() {
      vo = await E.deploy();
      pid = await E.must_propose(vo, E.secr1);
    });

    it("getProposalContent", async function() {
      let content = await vo.getProposalContent(pid);
      expect(content[0]).to.equal(pid);
      expect(content[1]).to.equal(E.secr1.address);
      expect(content[2]).to.equal(E.description);
    });
    it("getProposalSchedule default periods", async function() {
      let schedule = await vo.getProposalSchedule(pid);
      let proposeBlock = await nowBlock();

      let voteStart     = proposeBlock + E.votingDelay;
      let voteEnd       = voteStart    + E.votingPeriod;
      let queueDeadline = voteEnd      + parseInt(await vo.queueTimeout());

      expect(schedule[0]).to.equal(voteStart);
      expect(schedule[1]).to.equal(voteEnd);
      expect(schedule[2]).to.equal(queueDeadline);
      expect(schedule[3]).to.equal(0); // eta
      expect(schedule[4]).to.equal(0); // execDeadline
      expect(schedule[5]).to.equal(false); // canceled
      expect(schedule[6]).to.equal(false); // queued
      expect(schedule[7]).to.equal(false); // executed
    });
    it("getActions", async function() {
      let actions = await vo.getActions(pid);
      expect(actions[0]).to.deep.equal(E.targets);
      expect(actions[1]).to.equalNumberList(E.values);
      expect(actions[2]).to.deep.equal(E.signatures);
      expect(actions[3]).to.deep.equal(E.calldatas);
    });
    it("getProposalTally", async function() {
      let tally = await vo.getProposalTally(pid);
      expect(tally[0]).to.equal(0); // totalYes
      expect(tally[1]).to.equal(0); // totalNo
      expect(tally[2]).to.equal(0); // totalAbstain
      expect(tally[3]).to.equal(1); // quorumCount
      expect(tally[4]).to.equal(1); // quorumPower
      expect(tally[5]).to.equalAddrList([]); // voters
    });
  }); // proposal getters

  describe("cancel", function() {
    let vo;
    before(async function() {
      vo = await E.deploy();
    });

    it("success", async function() {
      let pid = await E.must_propose(vo, E.secr1);
      await E.must_cancel(vo, E.secr1, pid);
    });
    it("reject unknown id", async function() {
      await E.revert_cancel(vo, E.voter1, 999, "No such proposal");
    });
    it("reject non-proposer", async function() {
      let pid = await E.must_propose(vo, E.secr1);
      await E.revert_cancel(vo, E.voter1, pid, "Not the proposer");
      await E.revert_cancel(vo, E.other1, pid, "Not the proposer");
    });
  });

  describe("State precondition", function() {

    async function check_batch(vo, must_func, revert_func, answers) {
      for (var state of _.keys(E.State)) {
        let pid = await E.createProposalAt(vo, state);
        if (answers[state]) {
          await must_func(pid);
        } else {
          await revert_func(pid);
        }
      }
    }

    let vo;
    let msg = "Not allowed in current state";
    before(async function() {
      vo = await E.deploy();
    });

    it("cancel", async function() {
      await check_batch(vo,
        (pid) => E.must_cancel(vo, E.secr1, pid),
        (pid) => E.revert_cancel(vo, E.secr1, pid, msg),
        { Pending: true });
    });
    it("vote", async function() {
      await check_batch(vo,
        (pid) => E.must_vote(vo, E.voter1, pid, 'Yes'),
        (pid) => E.revert_vote(vo, E.voter1, pid, 'Yes', msg),
        { Active: true });
    });
    it("queue", async function() {
      await check_batch(vo,
        (pid) => E.must_queue(vo, E.secr1, pid),
        (pid) => E.revert_queue(vo, E.secr1, pid, msg),
        { Passed: true });
    });
    it("execute", async function() {
      let wait_must_execute = async function(pid) {
        await E.wait_eta(vo, pid);
        return E.must_execute(vo, E.secr1, pid, 0);
      };
      let wait_revert_execute = async function(pid) {
        await E.wait_eta(vo, pid);
        return E.revert_execute(vo, E.secr1, pid, 0, msg);
      };

      await check_batch(vo,
        wait_must_execute,
        wait_revert_execute,
        { Queued: true });
    });

  });
}
