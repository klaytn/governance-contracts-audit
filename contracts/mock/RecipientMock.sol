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

// This contract happily receive KLAY transfer transactions.
contract WelcomingRecipient {
    event CoinReceived(address sender, uint256 amount);

    function deposit() external payable {
        emit CoinReceived(msg.sender, msg.value);
    }

    receive() external payable {
        emit CoinReceived(msg.sender, msg.value);
    }
}

// This contract reverts upon KLAY transfer transactions.
contract DenyingRecipient {
    function deposit() external payable {
        revert("You cannot deposit");
    }

    receive() external payable {
        revert("I do not accept money");
    }
}

// Test ability to check contract type and version
contract TypeVersionMock {
    string public CONTRACT_TYPE;
    uint256 public VERSION;
    constructor(string memory t, uint256 v) {
        CONTRACT_TYPE = t;
        VERSION = v;
    }
}

contract TypeMock {
    string public CONTRACT_TYPE;
    constructor(string memory t) {
        CONTRACT_TYPE = t;
    }
}

contract VersionMock {
    uint256 public VERSION;
    constructor(uint256 v) {
        VERSION = v;
    }
}
