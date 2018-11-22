pragma solidity ^0.4.23;

contract Test {
    uint256 amount;

    constructor (uint256 value) public {
        amount = value;
    }

    event Add (uint256 value);

    function add (uint256 value) public {
        amount = amount + value;
        emit Add(amount);
    }
}
