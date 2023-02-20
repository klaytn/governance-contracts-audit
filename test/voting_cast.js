const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { getBalance, toKlay, toPeb, expectRevert, numericAddr } = require("./helper.js");

const NA = numericAddr;
const [ NA01, NA11, NA21, NA31, NA41 ] = [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ];
const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("castVote", function() {
    let vo;
    before(async function() {
      vo = await E.deploy(E.conf5cn);
    });

    describe("success", function() {
      let pid;
      before(async function() {
        pid = await E.createProposalAt(vo, 'Active');
      });

      it("different choices", async function() {
        await E.must_vote(vo, E.voter1, pid, 'Yes');
        await E.must_vote(vo, E.voter2, pid, 'No');
        await E.must_vote(vo, E.voter3, pid, 'Abstain');
        let tally = await vo.getProposalTally(pid);
        expect(tally[0]).to.equal(3);
        expect(tally[1]).to.equal(2);
        expect(tally[2]).to.equal(1);
        expect(tally[5]).to.equalNumberList([700,701,702]);
      });
      it("change voter before vote", async function() {
        await E.appointVoter(E.conf5cn, 3, E.other1);
        await E.must_vote(vo, E.other1, pid, 'Yes');
        await E.appointVoter(E.conf5cn, 3, E.voter4); // restore for other tests
      });
    }); // success

    describe("validation", function() {
      let pid;
      before(async function() {
        pid = await E.createProposalAt(vo, 'Active');
      });

      it("reject unknown id", async function() {
        await E.revert_vote(vo, E.voter4, 99, 'Yes', "No such proposal");
      });
      it("reject non-voter", async function() {
        await E.revert_vote(vo, E.secr1, pid, 'Yes', "Not a registered voter");
        await E.revert_vote(vo, E.other1, pid, 'Yes', "Not a registered voter");
      });
      it("reject zero votes voter", async function() {
        await E.revert_vote(vo, E.voter5, pid, 'Yes', "Not eligible to vote");
      });
      it("reject invalid choice", async function() {
        await E.revert_vote(vo, E.voter4, pid, 99, "Not a valid choice");
      });
      it("reject already voted", async function() {
        await E.must_vote(vo, E.voter4, pid, 'Yes');
        await E.revert_vote(vo, E.voter4, pid, 'Yes', "Already voted");

        // try with different voter address
        await E.appointVoter(E.conf5cn, 3, E.other1);
        await E.revert_vote(vo, E.other1, pid, 'Yes', "Already voted");
        await E.appointVoter(E.conf5cn, 3, E.voter4); // restore for other tests
      });
    }); // validation
  }); // castVote

  describe("quorum", function() {
    let vo;
    before(async function() {
      vo = await E.deploy(E.conf5cn);
    });

    describe("checkQuorum", function() {

      async function check_voting_result(inputVotes, expectedTally, expectedResult) {
        let pid = await E.createProposalAt(vo, 'Active');

        for (var vote of inputVotes) {
          let [voter, choice] = vote;
          await E.must_vote(vo, voter, pid, choice);
        }

        let tally = await vo.getProposalTally(pid);
        expect(tally[0]).to.equal(expectedTally[0]);
        expect(tally[1]).to.equal(expectedTally[1]);
        expect(tally[2]).to.equal(expectedTally[2]);

        let result = await vo.checkQuorum(pid);
        expect(result).to.equal(expectedResult);
      }

      it("quorumCount and quorumPower", async function() {
        // votes = [3,2,1,1,0]
        // pass by quorumCount (2)
        await check_voting_result([ [E.voter3,'Yes'], [E.voter4,'Yes'] ], [2,0,0], true);
        // pass by quorumPower (3)
        await check_voting_result([ [E.voter1,'Yes'] ], [3,0,0], true);
        // not quorumCount nor quorumPower
        await check_voting_result([],                   [0,0,0], false);
        await check_voting_result([ [E.voter3,'Yes'] ], [1,0,0], false);
      });
      it("approval rate", async function() {
        // only one vote
        await check_voting_result([ [E.voter1,'Yes'] ],     [3,0,0], true);
        await check_voting_result([ [E.voter1,'No'] ],      [0,3,0], false);
        await check_voting_result([ [E.voter1,'Abstain'] ], [0,0,3], false);

        // two votes with the same choice
        await check_voting_result([ [E.voter2,'Yes'], [E.voter3,'Yes'] ],         [3,0,0], true);
        await check_voting_result([ [E.voter2,'No'], [E.voter3,'No'] ],           [0,3,0], false);
        await check_voting_result([ [E.voter2,'Abstain'], [E.voter3,'Abstain'] ], [0,0,3], false);

        // various approval rate conditions
        // Yes < No + Abstain => Fail
        await check_voting_result([ [E.voter3,'Yes'], [E.voter2,'No'] ], [1,2,0], false);
        await check_voting_result([ [E.voter3,'Yes'], [E.voter2,'Abstain'] ], [1,0,2], false);
        // Yes = No + Abstain => Fail
        await check_voting_result([ [E.voter3,'Yes'], [E.voter4,'No'] ], [1,1,0], false);
        await check_voting_result([ [E.voter2,'Yes'], [E.voter3,'No'], [E.voter4,'Abstain'] ], [2,1,1], false);
        // No < Yes < No+Abstain  => Fail
        await check_voting_result([ [E.voter2,'Yes'], [E.voter3,'No'], [E.voter1,'Abstain'] ], [2,1,3], false);
        // Yes > No + Abstain => Pass
        await check_voting_result([ [E.voter1,'Yes'], [E.voter3,'No'], [E.voter4,'Abstain'] ], [3,1,1], true);
      });
    }); // checkQuorum

    describe("getQuorum", function() {
      async function check_getQuorum(conf, quorumCount, quorumPower) {
        await conf.deployOnce();
        let vo = await E.deploy(conf);
        for (const cnsAddr of conf.cnsAddrsList) {
          const cns = await ethers.getContractAt("CnStakingV2", cnsAddr);
          let stAddr = await vo.stakingTracker();
          await cns.connect(E.admin1).submitUpdateStakingTracker(stAddr);
        }

        let pid = await E.must_propose(vo, E.secr1);
        let tally = await vo.getProposalTally(pid);
        expect(tally[3]).to.equal(quorumCount);
        expect(tally[4]).to.equal(quorumPower);
      }

      it("success conf1cn", async function() {
        // [1] votes.
        // numEligible   = 1 => quorumCount = 1
        // totalVotes    = 1 => quorumPower = 1
        await check_getQuorum(E.conf1cn, 1, 1);
      });
      it("success conf3cn", async function() {
        // [2,2,1] votes.
        // numEligible   = 3 => quorumCount = 1
        // totalVotes    = 5 => quorumPower = 2
        await check_getQuorum(E.conf3cn, 1, 2);
      });
      it("success conf5cn", async function() {
        // [3,2,1,1,0] votes.
        // numEligible   = 4 => quorumCount = 2
        // totalVotes    = 7 => quorumPower = 3
        await check_getQuorum(E.conf5cn, 2, 3);
      });
      it("success conf50cn", async function() {
        // [1,..,1] votes.
        // numEligible   = 50 => quorumCount = 17
        // totalVotes    = 50 => quorumPower = 17
        await check_getQuorum(E.conf50cn, 17, 17);
      });
    }); // getQuorum

    describe("getVotes", function() {
      it("success conf1cn", async function() {
        let vo = await E.deploy(E.conf1cn);
        let pid = await E.must_propose(vo, E.secr1);
        await E.check_getVotes(vo, pid, E.voter1.address, 1, 700);
      });
      it("success conf5cn", async function() {
        let vo = await E.deploy(E.conf5cn);
        let pid = await E.must_propose(vo, E.secr1);
        await E.check_getVotes(vo, pid, E.voter1.address, 3, 700);
        await E.check_getVotes(vo, pid, E.voter2.address, 2, 701);
        await E.check_getVotes(vo, pid, E.voter3.address, 1, 702);
        await E.check_getVotes(vo, pid, E.voter4.address, 1, 703);
        await E.check_getVotes(vo, pid, E.voter5.address, 0, 704);
      });
      it("reject non-voter", async function() {
        let vo = await E.deploy(E.conf1cn);
        let pid = await E.must_propose(vo, E.secr1);
        await E.check_getVotes(vo, pid, E.secr1.address, 0, 0);
        await E.check_getVotes(vo, pid, E.other1.address, 0, 0);
      });
    }); // getVotes
  }); // quorum
}
