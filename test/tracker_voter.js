const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, setTime, nowBlock, setBlock, getBalance,
        toKlay, toPeb, expectRevert, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

const NA = numericAddr;
const [ NA01, NA11, NA21, NA31, NA41 ] = [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ];
const [ NA02, NA03, NA12, NA13, NA32 ] = [ NA(0,2), NA(0,3), NA(1,2), NA(1,3), NA(3,2) ];
const [ NA09, NA19, NA29, NA39, NA49 ] = [ NA(0,9), NA(1,9), NA(2,9), NA(3,9), NA(4,9) ];

module.exports = function(E) {

  describe("refreshVoter", function() {
    function tx_update(cns, voter) {
      return cns.connect(E.admin1).submitUpdateVoterAddress(voter);
    }
    async function must_update_refresh(st, cns, gcId, voterAddr) {
      await expect(tx_update(cns, voterAddr))
        .to.emit(cns, "UpdateVoterAddress").withArgs(voterAddr)
        .to.emit(st, "RefreshVoter").withArgs(gcId, cns.address, voterAddr);
      expect(await cns.voterAddress()).to.equal(voterAddr);
    }
    async function must_update_norefresh(st, cns, gcId, voterAddr) {
      await expect(tx_update(cns, voterAddr))
        .to.emit(cns, "UpdateVoterAddress").withArgs(voterAddr)
        .to.not.emit(st, "RefreshVoter");
      expect(await cns.voterAddress()).to.equal(voterAddr);
    }

    function tx_refresh(st, cnsAddr) {
      return st.connect(E.other1).refreshVoter(cnsAddr);
    }
    async function must_refresh(st, cnsAddr, gcId, voterAddr) {
      await expect(tx_refresh(st, cnsAddr))
        .to.emit(st, "RefreshVoter").withArgs(gcId, cnsAddr, voterAddr);
    }
    async function revert_refresh(st, cnsAddr, msg) {
      await expectRevert(tx_refresh(st, cnsAddr), msg);
    }

    it("success map", async function() {
      let { st, cns0 } = await E.deploy_get_cns0(E.conf1cn);
      let [ gcId, voter ] = [ 700, RAND_ADDR ];
      await E.check_voter_null(st, gcId, voter);

      await must_update_refresh(st, cns0, gcId, voter);
      await E.check_voter_mapped(st, gcId, voter);
    });
    it("success unmap", async function() {
      let { st, cns0 } = await E.deploy_get_cns0(E.conf1cn);
      let [ gcId, voter ] = [ 700, RAND_ADDR ];
      await E.check_voter_null(st, gcId, voter);

      await must_update_refresh(st, cns0, gcId, voter);
      await E.check_voter_mapped(st, gcId, voter);

      await must_update_refresh(st, cns0, gcId, NULL_ADDR);
      await E.check_voter_null(st, gcId, voter);
    });
    it("trigger by explicit refresh call", async function() {
      let { st, cns0 } = await E.deploy_get_cns0(E.conf1cn, false);
      let [ gcId, voter ] = [ 700, RAND_ADDR ];
      await E.check_voter_null(st, gcId, voter);

      await must_update_norefresh(st, cns0, gcId, voter); // refreshVoter not called
      await E.check_voter_null(st, gcId, voter);

      await must_refresh(st, cns0.address, gcId, voter); // applied by explicit refresh
      await E.check_voter_mapped(st, gcId, voter);

      await must_refresh(st, cns0.address, gcId, voter); // can call again
      await E.check_voter_mapped(st, gcId, voter);
    });
    it("overwrite by sister staking contract", async function() {
      let conf = E.createConf({ // One GC owns two CnStaking, cns0 and cns1.
        balances: [ [1, 5e6] ],
      });
      await conf.deploy();

      let st = await E.deploy(conf);
      let cns0 = await E.get_cns(conf, 0, 0, st);
      let cns1 = await E.get_cns(conf, 0, 1, st);
      let [ gcId, voterA, voterB ] = [ 700, E.voter1.address, E.voter2.address ];

      // Set (gcId <-> voterA) via cns0.
      await must_update_refresh(st, cns0, gcId, voterA);
      await E.check_voter_mapped(st, gcId, voterA);

      // Set (gcId <-> voterB) via cns1.
      await must_update_refresh(st, cns1, gcId, voterB);
      await E.check_voter_mapped(st, gcId, voterB);

      // But each cns contracts has different voters
      expect(await cns0.voterAddress()).to.equal(voterA);
      expect(await cns1.voterAddress()).to.equal(voterB);
    });
    it("reject duplicate voter address", async function() {
      let conf = E.createConf({ // Two GCs own one CnStaking each, cns0 and cns1.
        balances: [ [5e6], [5e6] ],
      });
      await conf.deploy();

      let st = await E.deploy(conf);
      let cns0 = await E.get_cns(conf, 0, 0, st);
      let cns1 = await E.get_cns(conf, 1, 0, st);
      let [ gc0, gc1, voter ] = [ 700, 701, E.voter1.address ];

      // Set (gc0 <-> voter) via cns0.
      await must_update_refresh(st, cns0, gc0, voter);

      // Try to set (gc1 <-> voter) via cns1.
      // cns1.submitUpdateVoterAddress() fails.
      await expectRevert(tx_update(cns1, voter), "Voter address already taken");

      expect(await st.gcIdToVoter(700)).to.equal(voter); // gc0 -> voter
      expect(await st.voterToGCId(voter)).to.equal(700); // voter -> gc0
      expect(await st.gcIdToVoter(701)).to.equal(NULL_ADDR); // gc1 -> NULL
    });
    it("reject non-registered", async function() {
      let st = await E.deploy(E.conf1cn);
      // Note that this fresh cnsv2 is not registered in AddressBook.
      let cnsv2 = await E.createCnStaking(E.CnStakingV2, NA01, NA09, 1, toPeb(5e6));

      await revert_refresh(st, cnsv2.address, "Not a staking contract");
    });
    it("reject non-CnStakingV2", async function() {
      let Invalid = await ethers.getContractFactory("WelcomingRecipient");
      let invalid = await Invalid.deploy();

      // Fill AddressBook with invalid staking addresses
      let abook = await E.createAbook([NA01, NA11, NA21],
                                      [NULL_ADDR, RAND_ADDR, invalid.address],
                                      [NA09, NA19, NA29]);
      let st = await E.deploy({ abookAddr: abook.address });

      await revert_refresh(st, NULL_ADDR, "Invalid CnStaking contract");
      await revert_refresh(st, RAND_ADDR, "Invalid CnStaking contract");
      await revert_refresh(st, invalid.address, "Invalid CnStaking contract");
    });
    it("reject CnStakingV1", async function() {
      let cnsv1 = await E.createCnStaking(E.CnStakingV1, NA02, NA09, 1, toPeb(7e6));
      let abook = await E.createAbook([NA01], [cnsv1.address], [NA09]);
      let st = await E.deploy({ abookAddr: abook.address });

      await revert_refresh(st, cnsv1.address, "Invalid CnStaking contract");
    });
  }); // refreshVoter
}
