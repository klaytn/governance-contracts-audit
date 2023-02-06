const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { getBalance, toKlay, toPeb, expectRevert, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

const NA = numericAddr;
const [ NA01, NA11, NA21, NA31, NA41 ] = [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ];
const [ NA02, NA03, NA12, NA13, NA32 ] = [ NA(0,2), NA(0,3), NA(1,2), NA(1,3), NA(3,2) ];
const [ NA09, NA19, NA29, NA39, NA49 ] = [ NA(0,9), NA(1,9), NA(2,9), NA(3,9), NA(4,9) ];

module.exports = function(E) {

  describe("init", function() {

    describe("constructor", function() {
      it("success", async function() {
        await E.deploy();
      });
    }); // constructor

    describe("constants", function() {
      it("success", async function() {
        // contribute to the code coverage of the original contract
        let StakingTracker = await ethers.getContractFactory("StakingTracker");
        let st = await StakingTracker.connect(E.deployer).deploy();
        expect(await st.CONTRACT_TYPE()).to.equal("StakingTracker");
        expect(await st.VERSION()).to.equal(1);
        expect(await st.ADDRESS_BOOK_ADDRESS())
          .to.equal("0x0000000000000000000000000000000000000400");
      });
    }); // constants

    describe("Ownable", function() {
      let st;
      let oldAddr, newAddr;
      beforeEach(async function() {
        st = await E.deploy();
        oldAddr = E.deployer.address;
        newAddr = E.admin1.address;
      });

      it("owner", async function() {
        expect(await st.owner()).to.equal(oldAddr);
      });
      it("success transfer", async function() {
        await expect(st.transferOwnership(newAddr))
          .to.emit(st, "OwnershipTransferred").withArgs(oldAddr, newAddr);
        expect(await st.owner()).to.equal(newAddr);
      });
      it("reject transfer by non-owner", async function() {
        await expectRevert(st.connect(E.other1).transferOwnership(newAddr),
          "Ownable: caller is not the owner");
        expect(await st.owner()).to.equal(oldAddr);
      });
    }); // Ownable
  }); // init

  describe("createTracker", function() {
    async function check_create(conf) {
      await conf.deployOnce();
      let st = await E.deploy({ abookAddr: conf.abookAddr });
      for (const cnsAddr of conf.cnsAddrsList) {
        const cns = await ethers.getContractAt("CnStakingV2", cnsAddr);
        await cns.connect(E.admin1).submitUpdateStakingTracker(st.address);
      }
      let { tid, ts, te } = await E.must_create(st);
      await E.check_tracker(st, tid, conf, ts, te);
      return { st, tid };
    }

    // conf1cn    / 1   node 1   contract  / createTracker = 395,025    gas
    // conf5cn    / 5   node 9   contracts / createTracker = 1,212,601  gas
    // conf50cn   / 50  node 50  contracts / createTracker = 7,878,196  gas
    // conf50x2cn / 50  node 100 contracts / createTracker = 9,772,629  gas
    // conf100cn  / 100 node 100 contracts / createTracker = 15,517,914 gas
    it("success 1cn", async function() {
      await check_create(E.conf1cn);
    });
    it("success 5cn", async function() {
      await check_create(E.conf5cn);
    });
    it("success 50cn", async function() {
      await check_create(E.conf50cn);
    });
    it("success 50x2cn", async function() {
      await check_create(E.conf50x2cn);
    });
    it("success 100cn", async function() {
      await check_create(E.conf100cn);
    });

    it("stakingToGCId", async function() {
      let { st, tid } = await check_create(E.conf5cn);

      // See StakingTrackerTestEnv._createEnv() for definition of conf5cn
      let cnsAddrs = E.conf5cn.cnsAddrs;
      let answers = [
        [cnsAddrs[0][0], 700],

        [cnsAddrs[1][0], 701],
        [cnsAddrs[1][1], 701],

        [cnsAddrs[2][0], 702],
        [cnsAddrs[2][1], 702],
        [cnsAddrs[2][2], 702],

        [cnsAddrs[3][0], 703],
        [cnsAddrs[3][1], 703],

        [cnsAddrs[4][0], 704],
      ];

      for (var answer of answers) {
        let [staking, gcId] = answer;
        expect(await st.stakingToGCId(tid, staking)).to.equal(gcId);
      }
    });

    it("reject non-owner", async function() {
      let st = await E.deploy({ abookAddr: E.conf1cn.abookAddr });
      await expectRevert(E.tx_create(st, E.other1), "Ownable: caller is not the owner");
    });
    it("reject wrong AddressBook", async function() {
      let ABook = await ethers.getContractFactory("AddressBookMockWrong");
      let abook = await ABook.deploy();

      let st = await E.deploy({ abookAddr: abook.address });
      await expectRevert(E.tx_create(st), "Invalid data");
    });

    async function check_cns_invalid(cnsOk, cnsBad) {
      // Test a situation where one CN has two staking contracts cnsOk and cnsBad.
      // cnsBad must be ignored in createTracker().
      let abook = await E.createAbook([NA01, NA02],
                                      [cnsOk.address, cnsBad.address],
                                      [NA09, NA09]);

      // createTracker must succeed even with invalid contracts in AddressBook.
      let st = await E.deploy({ abookAddr: abook.address });
      let cnsv2 = await ethers.getContractAt("CnStakingV2", cnsOk.address);
      await cnsv2.connect(E.admin1).submitUpdateStakingTracker(st.address);
      let { tid, ts, te } = await E.must_create(st);

      // The tracker must contain exactly one contract.
      let balanceOk = toKlay(await getBalance(cnsOk.address));
      let conf = E.createConf({ balances: [ [ balanceOk ] ] });
      await E.check_tracker(st, tid, conf, ts, te);
    }

    it("ignore non-CnStaking", async function() {
      let cnsv2 = await E.createCnStaking(E.CnStakingV2, NA01, NA09, 700, toPeb(5e6));

      let Invalid = await ethers.getContractFactory("WelcomingRecipient");
      let invalid = await Invalid.deploy();
      await invalid.deposit({ value: toPeb(7e6) });

      await check_cns_invalid(cnsv2, invalid);
    });
    it("ignore CnStakingV1", async function() {
      let cnsv2 = await E.createCnStaking(E.CnStakingV2, NA01, NA09, 700, toPeb(5e6));
      let cnsv1 = await E.createCnStaking(E.CnStakingV1, NA02, NA09, 700, toPeb(7e6));
      await check_cns_invalid(cnsv2, cnsv1);
    });
    it("ignore CnStakingV2 with wrong tracker", async function() {
      let cnsOk = await E.createCnStaking(E.CnStakingV2, NA01, NA09, 700, toPeb(5e6));
      // cnsBad.stakingTracker is NULL
      let cnsBad = await E.createCnStaking(E.CnStakingV2, NA02, NA09, 700, toPeb(7e6));
      await check_cns_invalid(cnsOk, cnsBad);
    });
  }); // createTracker

  describe("isCnStakingV2", function() {
    let st;
    before(async function() {
      st = await E.deploy();
    });

    async function check_isv2(address, expected) {
      expect(await st.isCnStakingV2(address)).to.equal(expected);
    }

    // common cases
    it("accept v2", async function() {
      let cnsv2 = await E.createCnStaking(E.CnStakingV2, NA01, NA09, 1, toPeb(5e6));
      await check_isv2(cnsv2.address, true);
    });
    it("reject CnStakingV1", async function() {
      let cnsv1 = await E.createCnStaking(E.CnStakingV1, NA02, NA09, 1, toPeb(7e6));
      await check_isv2(cnsv1.address, false);
    });

    // corner cases

    async function deploy_Factory(name, ctorArgs) {
      let Factory = await ethers.getContractFactory(name);
      let contract = await Factory.deploy(...ctorArgs);
      return contract.address;
    }

    it("reject EOA", async function() {
      await check_isv2(RAND_ADDR, false);
    });
    it("reject no type", async function() {
      let addr = await deploy_Factory("WelcomingRecipient", []);
      await check_isv2(addr, false);
    });
    it("reject wrong type", async function() {
      let addr = await deploy_Factory("TypeMock", ["ContractX"]);
      await check_isv2(addr, false);
    });
    it("reject no version", async function() {
      let addr = await deploy_Factory("TypeMock", ["CnStakingContract"]);
      await check_isv2(addr, false);
    });
    it("reject wrong version", async function() {
      let addr = await deploy_Factory("TypeVersionMock", ["CnStakingContract", 1]);
      await check_isv2(addr, false);
    });
  }); // isCnStakingV2
}
