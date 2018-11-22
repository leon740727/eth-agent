var MyContract = artifacts.require("Test");

module.exports = function(deployer) {
  // deployment steps
  deployer.deploy(MyContract, 0);
};
