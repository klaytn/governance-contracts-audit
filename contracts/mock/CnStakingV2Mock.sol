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
import "../ICnStakingV2.sol";
import "../CnStakingV2.sol";

contract CnStakingV2Mock is CnStakingV2 {
    address private addressBookAddress = 0x0000000000000000000000000000000000000400;
    function mockSetAddressBookAddress(address _addr) external { addressBookAddress = _addr; }
    function ADDRESS_BOOK_ADDRESS() public view virtual override returns(address) { return addressBookAddress; }

    uint256 maxAdmin = 50;
    function mockSetMaxAdmin(uint256 _max) external { maxAdmin = _max; }
    function MAX_ADMIN() public view virtual override returns(uint256) { return maxAdmin; }

    constructor(address _contractValidator, address _nodeId, address _rewardAddress,
                address[] memory _cnAdminlist, uint256 _requirement,
                uint256[] memory _unlockTime, uint256[] memory _unlockAmount)
        CnStakingV2(_contractValidator, _nodeId, _rewardAddress,
                    _cnAdminlist, _requirement,
                    _unlockTime, _unlockAmount) { }
}
