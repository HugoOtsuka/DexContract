import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Token } from "../interfaces/Token";

const SIDE = {
  BUY: 0,
  SELL: 1,
};

describe("Dex", function () {
  const [DAI, BAT, REP, ZRX] = ["DAI", "BAT", "REP", "ZRX"].map((ticker) =>
    ethers.encodeBytes32String(ticker)
  );
  async function deployOnceFixture() {
    const accounts = await ethers.getSigners();
    const [trader1, trader2] = [accounts[1], accounts[2]];

    let [Dex, Dai, Bat, Rep, Zrx] = await Promise.all([
      ethers.getContractFactory("Dex"),
      ethers.getContractFactory("Dai"),
      ethers.getContractFactory("Bat"),
      ethers.getContractFactory("Rep"),
      ethers.getContractFactory("Zrx"),
    ]);
    let [dex, dai, bat, rep, zrx] = await Promise.all([
      Dex.deploy(),
      Dai.deploy(),
      Bat.deploy(),
      Rep.deploy(),
      Zrx.deploy(),
    ]);
    await dex.waitForDeployment();
    await dai.waitForDeployment();
    await bat.waitForDeployment();
    await rep.waitForDeployment();
    await zrx.waitForDeployment();

    await Promise.all([
      dex.addToken(DAI, dai.getAddress()),
      dex.addToken(BAT, bat.getAddress()),
      dex.addToken(REP, rep.getAddress()),
      dex.addToken(ZRX, zrx.getAddress()),
    ]);
    const amount = ethers.parseEther("1000");
    const seedTokenBalance = async (token: Token, trader: Signer) => {
      await token.faucet(trader, amount);
      await token.connect(trader).approve(dex.getAddress(), amount);
    };
    await Promise.all(
      [dai, bat, rep, zrx].map((token) => seedTokenBalance(token, trader1))
    );
    await Promise.all(
      [dai, bat, rep, zrx].map((token) => seedTokenBalance(token, trader2))
    );

    return { trader1, trader2, dex, dai };
  }

  describe("Wallet", function () {
    it("Should deposit tokens", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      const amount = ethers.parseEther("100");
      await dex.connect(trader1).deposit(amount, DAI);
      const balance = await dex.traderBalances(trader1, DAI);
      expect(balance.toString()).to.equal(amount);
    });

    it("Should NOT deposit tokens if token does not exist", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .deposit(
            ethers.parseEther("1000"),
            ethers.encodeBytes32String("TOKEN-DOES-NOT-EXIST")
          )
      ).to.be.revertedWith("this token doesn't exist");
    });

    it("Should withdraw tokens", async function () {
      const { trader1, dex, dai } = await loadFixture(deployOnceFixture);
      const amount = ethers.parseEther("100");
      await dex.connect(trader1).deposit(amount, DAI);
      await dex.connect(trader1).withdraw(amount, DAI);
      const [balanceDex, balanceDai] = await Promise.all([
        dex.traderBalances(trader1, DAI),
        dai.balanceOf(trader1),
      ]);
      expect(balanceDex).to.equal(0);
      expect(balanceDai.toString()).to.equal(ethers.parseEther("1000"));
    });

    it("Should NOT withdraw tokens if token does not exist", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .withdraw(
            ethers.parseEther("1000"),
            ethers.encodeBytes32String("TOKEN-DOES-NOT-EXIST")
          )
      ).to.be.revertedWith("this token doesn't exist");
    });

    it("Should NOT withdraw tokens if balance too low", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await dex.connect(trader1).deposit(ethers.parseEther("100"), DAI);
      await expect(
        dex.connect(trader1).withdraw(ethers.parseEther("1000"), DAI)
      ).to.be.revertedWith("balance too low");
    });
  });

  describe("Limit orders", function () {
    it("Should create limit order", async function () {
      const { trader1, trader2, dex } = await loadFixture(deployOnceFixture);
      await dex.connect(trader1).deposit(ethers.parseEther("100"), DAI);
      await dex
        .connect(trader1)
        .createLimitOrder(REP, ethers.parseEther("10"), 10, SIDE.BUY);
      let buyOrders = await dex.getOrders(REP, SIDE.BUY);
      let sellOrders = await dex.getOrders(REP, SIDE.SELL);
      expect(buyOrders.length).to.equal(1);
      expect(buyOrders[0].trader).to.equal(await trader1.getAddress());
      expect(sellOrders.length).to.equal(0);
      await dex.connect(trader2).deposit(ethers.parseEther("200"), DAI);
      await dex
        .connect(trader2)
        .createLimitOrder(REP, ethers.parseEther("10"), 11, SIDE.BUY);
      buyOrders = await dex.getOrders(REP, SIDE.BUY);
      sellOrders = await dex.getOrders(REP, SIDE.SELL);
      expect(buyOrders.length).to.equal(2);
      expect(buyOrders[0].trader).to.equal(await trader2.getAddress());
      expect(buyOrders[1].trader).to.equal(await trader1.getAddress());
      expect(sellOrders.length).to.equal(0);
      await dex.connect(trader2).deposit(ethers.parseEther("200"), DAI);
      await dex
        .connect(trader2)
        .createLimitOrder(REP, ethers.parseEther("10"), 9, SIDE.BUY);
      buyOrders = await dex.getOrders(REP, SIDE.BUY);
      sellOrders = await dex.getOrders(REP, SIDE.SELL);
      expect(buyOrders.length).to.equal(3);
      expect(buyOrders[0].trader).to.equal(await trader2.getAddress());
      expect(buyOrders[1].trader).to.equal(await trader1.getAddress());
      expect(buyOrders[2].trader).to.equal(await trader2.getAddress());
      expect(sellOrders.length).to.equal(0);
    });

    it("Should NOT create limit order if balance too low", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await dex.connect(trader1).deposit(ethers.parseEther("99"), DAI);
      await expect(
        dex
          .connect(trader1)
          .createLimitOrder(REP, ethers.parseEther("10"), 10, SIDE.BUY)
      ).to.be.revertedWith("DAI balance too low");
    });

    it("Should NOT create limit order if token is DAI", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .createLimitOrder(DAI, ethers.parseEther("1000"), 10, SIDE.BUY)
      ).to.be.revertedWith("cannot trade DAI");
    });

    it("Should NOT create limit order if token does not not exist", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .createLimitOrder(
            ethers.encodeBytes32String("TOKEN-DOES-NOT-EXIST"),
            ethers.parseEther("1000"),
            10,
            SIDE.BUY
          )
      ).to.be.revertedWith("this token doesn't exist");
    });
  });

  describe("Market orders", function () {
    it("Should create market order & match", async function () {
      const { trader1, trader2, dex } = await loadFixture(deployOnceFixture);
      await dex.connect(trader1).deposit(ethers.parseEther("100"), DAI);
      await dex
        .connect(trader1)
        .createLimitOrder(REP, ethers.parseEther("10"), 10, SIDE.BUY);
      await dex.connect(trader2).deposit(ethers.parseEther("100"), REP);
      await dex
        .connect(trader2)
        .createMarketOrder(REP, ethers.parseEther("5"), SIDE.SELL);
      const balances = await Promise.all([
        dex.traderBalances(trader1, DAI),
        dex.traderBalances(trader1, REP),
        dex.traderBalances(trader2, DAI),
        dex.traderBalances(trader2, REP),
      ]);
      const orders = await dex.getOrders(REP, SIDE.BUY);
      expect(orders.length).to.equal(1);
      expect(orders[0].filled).to.equal(ethers.parseEther("5"));
      expect(balances[0].toString()).to.equal(ethers.parseEther("50"));
      expect(balances[1].toString()).to.equal(ethers.parseEther("5"));
      expect(balances[2].toString()).to.equal(ethers.parseEther("50"));
      expect(balances[3].toString()).to.equal(ethers.parseEther("95"));
    });

    it("Should NOT create market order if balance too low", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .createMarketOrder(REP, ethers.parseEther("101"), SIDE.SELL)
      ).to.be.revertedWith("token balance too low");
    });

    it("Should NOT create market order if token is DAI", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .createMarketOrder(DAI, ethers.parseEther("1000"), SIDE.BUY)
      ).to.be.revertedWith("cannot trade DAI");
    });

    it("Should NOT create market order if token does not not exist", async function () {
      const { trader1, dex } = await loadFixture(deployOnceFixture);
      await expect(
        dex
          .connect(trader1)
          .createMarketOrder(
            ethers.encodeBytes32String("TOKEN-DOES-NOT-EXIST"),
            ethers.parseEther("1000"),
            SIDE.BUY
          )
      ).to.be.revertedWith("this token doesn't exist");
    });
  });
});
