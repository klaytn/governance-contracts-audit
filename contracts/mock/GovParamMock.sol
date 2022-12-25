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

contract GovParamMock {
    string[] keys;
    bytes[] values;

    constructor() {
        keys.push("kip71.basefeedenominator");
        keys.push("kip71.upperboundbasefee");

        values.push("0x30");
    }

    function getAllParamsAt(uint256 blockNumber)
        external
        view
        returns (string[] memory, bytes[] memory)
    {
        // revert("nononono");  // revert test
        return (keys, values);
    }
}
