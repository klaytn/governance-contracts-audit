const { expect, Assertion } = require("chai");
const { ethers } = require("hardhat");
const { constants } = require('@openzeppelin/test-helpers');
const _ = require("lodash");

// Time related
async function nowBlock() {
    return parseInt(await hre.network.provider.send("eth_blockNumber"));
}
async function nowTime() {
    // hardhat simulated node has separate timer that increases every time
    // a new block is mined (which is basically every transaction).
    // Therefore nowTime() != Date.now().
    let block = await hre.network.provider.send('eth_getBlockByNumber', ['latest', false]);
    return parseInt(block.timestamp);
}
async function setBlock(num) {
    let now = await nowBlock();
    if (now < num) {
        blocksToMine = "0x" + (num - now).toString(16);
        await hre.network.provider.send("hardhat_mine", [blocksToMine]);
    }
}
async function setTime(timestamp) {
    // https://ethereum.stackexchange.com/questions/86633/time-dependent-tests-with-hardhat
    await hre.network.provider.send("evm_mine", [timestamp]);
}

// Query chain
async function getBalance(address) {
    let hex = await hre.network.provider.send("eth_getBalance", [address]);
    return ethers.BigNumber.from(hex, 16).toString();
}

// Data conversion
function toPeb(klay) {
    return ethers.utils.parseEther(klay.toString()).toString();
}
function toKlay(peb) {
    return ethers.utils.formatEther(peb);
}
function addPebs(a, b) {
    let bigA = ethers.BigNumber.from(a);
    let bigB = ethers.BigNumber.from(b);
    return bigA.add(bigB).toString();
}
function subPebs(a, b) {
    let bigA = ethers.BigNumber.from(a);
    let bigB = ethers.BigNumber.from(b);
    return bigA.sub(bigB).toString();
}
function toBytes32(x) {
    try {
        return ethers.utils.hexZeroPad(x, 32).toLowerCase();
    } catch {}

    try {
        let num = ethers.BigNumber.from(x).toHexString();
        return ethers.utils.hexZeroPad(num, 32).toLowerCase();
    } catch {}

    return x;
}
function numericAddr(n, m) {
    // Return a human-friendly address to be used as placeholders.
    // ex. CN #42, second node ID is:
    // numericAddr(42, 2) => 0x4202000000000000000000000000000000000001
    let a = (n < 10) ? ('0' + n) : ('' + n);
    let b = (m < 10) ? ('0' + m) : ('' + m);
    return "0x" + a + b + '00'.repeat(17) + '01';
}

// Convert an array with non-numeric key to an object.
// [ 11, 22, _x: 11, _y: 22 ] => { '0': 11, '1': 22, _x: 11, _y: 22 }
function arrToObj(arr) {
    return Object.assign({}, arr);
}

// Augment chai expect(..) assertion
// - .to.equal(..) with more generous type check
// - .to.emit(..) for CnStaking specific events
function augmentChai() {
    Assertion.addMethod('equalAddrList', function(arr) {
        arr = _.map(arr, (elem) => (elem.address || elem));
        var expected = _.map(arr, (elem) => elem.toLowerCase());
        var actual = _.map(this._obj, (elem) => elem.toLowerCase());
        return this.assert(
            _.isEqual(expected, actual),
            "expected #{this} to be equal to #{arr}",
            "expected #{this} to not equal to #{arr}",
            expected,
            actual
        );
    });
    Assertion.addMethod('equalNumberList', function(arr) {
        var expected = _.map(arr, (elem) => elem.toString());
        var actual = _.map(this._obj, (elem) => elem.toString());
        return this.assert(
            _.isEqual(expected, actual),
            "expected #{this} to be equal to #{arr}",
            "expected #{this} to not equal to #{arr}",
            expected,
            actual
        );
    });

    Assertion.addMethod('emitFunction6', function(cns, name, id, sender, funcId, a1, a2, a3) {
        sender = sender.address || sender;
        return new Assertion(this._obj)
            .to.emit(cns, name)
            .withArgs(id, sender, funcId, toBytes32(a1), toBytes32(a2), toBytes32(a3));
    });
    Assertion.addMethod('emitFunction7', function(cns, name, id, sender, funcId, a1, a2, a3, confirmers) {
        sender = sender.address || sender;
        confirmers = _.map(confirmers, (elem) => (elem.address || elem));
        return new Assertion(this._obj)
            .to.emit(cns, name)
            .withArgs(id, sender, funcId, toBytes32(a1), toBytes32(a2), toBytes32(a3), confirmers);
    });

    Assertion.addMethod('emitSubmit', function(cns, id, sender, funcId, a1, a2, a3) {
        return new Assertion(this._obj).to.emitFunction6(cns, "SubmitRequest", id, sender, funcId, a1, a2, a3);
    });
    Assertion.addMethod('emitConfirm', function(cns, id, sender, funcId, a1, a2, a3, confirmers) {
        return new Assertion(this._obj).to.emitFunction7(cns, "ConfirmRequest", id, sender, funcId, a1, a2, a3, confirmers);
    });
    Assertion.addMethod('emitRevoke', function(cns, id, sender, funcId, a1, a2, a3, confirmers) {
        return new Assertion(this._obj).to.emitFunction7(cns, "RevokeConfirmation", id, sender, funcId, a1, a2, a3, confirmers);
    });
    Assertion.addMethod('emitCancel', function(cns, id, sender, funcId, a1, a2, a3) {
        return new Assertion(this._obj).to.emitFunction6(cns, "CancelRequest", id, sender, funcId, a1, a2, a3);
    });
    Assertion.addMethod('emitSuccess', function(cns, id, sender, funcId, a1, a2, a3) {
        return new Assertion(this._obj).to.emitFunction6(cns, "ExecuteRequestSuccess", id, sender, funcId, a1, a2, a3);
    });
    Assertion.addMethod('emitFailure', function(cns, id, sender, funcId, a1, a2, a3) {
        return new Assertion(this._obj).to.emitFunction6(cns, "ExecuteRequestFailure", id, sender, funcId, a1, a2, a3);
    });
}

async function expectRevert(expr, message) {
    return expect(expr).to.be.revertedWith(message);
}

module.exports = {
    nowBlock,
    nowTime,
    setBlock,
    setTime,

    getBalance,

    toPeb,
    toKlay,
    addPebs,
    subPebs,
    toBytes32,
    numericAddr,
    arrToObj,

    augmentChai,
    expectRevert,
};
