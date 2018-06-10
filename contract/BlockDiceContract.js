var DiceConfig = function (text) {
  if (text) {
    var obj = JSON.parse(text);
    this.bidPrice = obj.bidPrice;
    this.bidTotal = obj.bidTotal;
    this.feeRate = obj.feeRate;
  } else {
    this.bidPrice = 0;
    this.bidTotal = 0;
    this.feeRate = 0;
  }
};

DiceConfig.prototype = {
  toString: function () {
    return JSON.stringify(this);
  }
};

var Bid = function (text) {
  if (text) {
    var obj = JSON.parse(text);
    this.period = obj.period;
    this.biders = obj.biders;
    this.winner = obj.winner;
    this.type = obj.type;
    this.timestamp = obj.timestamp;
  } else {
    this.period = 1;
    this.biders = [];
    this.winner = "";
    this.type = "";
    this.timestamp = null;
  }
}

Bid.prototype = {
  toString: function () {
    return JSON.stringify(this);
  }
};


var BlockDiceContract = function () {
  LocalContractStorage.defineMapProperty(this, "currentBidMap", {
    parse: function (text) {
      return new Bid(text);
    },
    stringify: function (o) {
      return o.toString();
    }
  });
  LocalContractStorage.defineMapProperty(this, "historyBidMap", {
    parse: function (text) {
      return new Bid(text);
    },
    stringify: function (o) {
      return o.toString();
    }
  });
  LocalContractStorage.defineMapProperty(this, "diceConfigMap", {
    parse: function (text) {
      return new DiceConfig(text);
    },
    stringify: function (o) {
      return o.toString();
    }
  });
  LocalContractStorage.defineProperty(this, "diceConfigArray");
  LocalContractStorage.defineMapProperty(this, "historyIndexMap");
  LocalContractStorage.defineProperty(this, "historySize");
  LocalContractStorage.defineProperty(this, "adminAddress"); //管理员账户地址
  LocalContractStorage.defineProperty(this, "commisionAddress"); //手续费收款地址
  LocalContractStorage.defineProperty(this, "stoped");
}

BlockDiceContract.prototype = {

  init: function () {
    this.diceConfigArray = [];
    var firstInitConfig = new DiceConfig();
    firstInitConfig.bidPrice = 0.1;
    firstInitConfig.bidTotal = 10;
    firstInitConfig.feeRate = 0.01;

    var secondInitConfig = new DiceConfig();
    secondInitConfig.bidPrice = 0.5;
    secondInitConfig.bidTotal = 10;
    secondInitConfig.feeRate = 0.01;

    var thirdInitConfig = new DiceConfig();
    thirdInitConfig.bidPrice = 1;
    thirdInitConfig.bidTotal = 10;
    thirdInitConfig.feeRate = 0.01;

    this.diceConfigMap.set('0.1', firstInitConfig);
    this.diceConfigMap.set('0.5', secondInitConfig);
    this.diceConfigMap.set('1', thirdInitConfig);
    this.diceConfigArray.push('0.1');
    this.diceConfigArray.push('0.5');
    this.diceConfigArray.push('1');


    var from = Blockchain.transaction.from;
    this.adminAddress = from;
    this.commisionAddress = from;
    this.historySize = 0;
    this.stoped = false;
  },

  bid: function (bidType, bidNum) {

    if(this.stoped){
      throw new Error("投注已被暂停，请等管理员开启后再参与投注");
    }

    var from = Blockchain.transaction.from;
    var value = Blockchain.transaction.value;

    if (value <= 0) {
      throw new Error("投注金额不能为空，请重新设置投注金额！");
    }

    var diceConfig = this.diceConfigMap.get(bidType);
    if (!diceConfig) {
      throw new Error("该投注类型并未设置，请选择已设置的投注类型！");
    }

    // 投注数量
    bidNum = parseInt(bidNum);
    // 投注大小
    var currentBidPrice = diceConfig.bidPrice;
    // 所需投注的金额
    var bidNeedValue = bidNum * currentBidPrice;
    bidNeedValue = bidNeedValue.toFixed(5);
    var needBidValue = new BigNumber(bidNeedValue).mul(new BigNumber(10).pow(18));

    // 实际所投金额
    var bidValue = new BigNumber(value);
    if (bidValue.lt(needBidValue)) {
      throw new Error("实际投注金额小于所需投注金额，请重新设置投注金额！");
    }

    // 当前投注数据
    var currentBid = this.currentBidMap.get(bidType);
    if (!currentBid) {
      currentBid = new Bid();
      currentBid.type = bidType;
      var ts = Blockchain.transaction.timestamp;
      currentBid.timestamp = ts;
    }
    // 当前投注数量
    var currentBidSize = currentBid.biders.length;
    // 剩余投注数量
    var leftBidSize = diceConfig.bidTotal - currentBidSize;
    if (leftBidSize <= 0) {
      throw new Error("当前投注轮次已经投满，请投下一轮！");
    }

    leftBidSize = parseInt(leftBidSize);
    if (bidNum > leftBidSize) {
      throw new Error("投注数量超过剩余投注数量，请减少投注数量！");
    }

    // 剩余投注金额
    var leftValue = leftBidSize * currentBidPrice;
    leftValue = leftValue.toFixed(5);
    var leftBidValue = new BigNumber(leftValue).mul(new BigNumber(10).pow(18));
    if (bidValue.gt(leftBidValue)) {
      throw new Error("投注金额超过了剩余最大投注金额，请重新设置投注金额！");
    }

    for (var i = 0; i < bidNum; i++) {
      currentBid.biders.push(from);
    }

    // 投注结束后的投注总数
    var afterBidSize = currentBid.biders.length;
    if (afterBidSize >= diceConfig.bidTotal) {
      // 开奖
      var winnerIndex = this.randomInt(diceConfig.bidTotal);
      var winner = currentBid.biders[winnerIndex];
      var totalAward = new BigNumber(currentBidPrice).mul(new BigNumber(diceConfig.bidTotal));
      totalAward = totalAward.mul(new BigNumber(10).pow(18));
      var winnerAward = totalAward.mul(new BigNumber(1).sub(new BigNumber(diceConfig.feeRate)));
      var result = Blockchain.transfer(winner, winnerAward);
      if (!result) {
        Event.Trigger("WinnerTransferFailed", {
          Transfer: {
            from: Blockchain.transaction.to,
            to: winner,
            value: winnerAward.toString()
          }
        });

        throw new Error("Winner Award transfer failed. Winner Address:" + winner + ", NAS:" + winnerAward.toString() +
          ", BidType: " + bidType);
      }

      Event.Trigger("WinnerTransferSuccess", {
        Transfer: {
          from: Blockchain.transaction.to,
          to: winner,
          value: winnerAward.toString()
        }
      });

      var commision = totalAward.sub(winnerAward);
      result = Blockchain.transfer(this.commisionAddress, commision);
      if (!result) {
        Event.Trigger("CommisionTransferFailed", {
          Transfer: {
            from: Blockchain.transaction.to,
            to: this.commisionAddress,
            value: commision.toString()
          }
        });

        throw new Error("Commision transfer failed. Commision Address:" + this.commisionAddress + ", NAS:" + commision.toString() +
          ", BidType: " + bidType);
      }

      Event.Trigger("CommisionTransferSuccess", {
        Transfer: {
          from: Blockchain.transaction.to,
          to: this.commisionAddress,
          value: commision.toString()
        }
      });

      currentBid.winner = winner;

      var index = this.historySize;
      var hash = Blockchain.transaction.hash;
      this.historyIndexMap.set(index, hash);
      this.historyBidMap.put(hash, currentBid);
      this.historySize += 1;

      var currentPeriod = currentBid.period;
      var period = currentPeriod + 1;
      var newBid = new Bid();
      newBid.period = period;
      newBid.type = bidType;
      var ts = Blockchain.transaction.timestamp;
      newBid.timestamp = ts;
      this.currentBidMap.del(bidType);
      this.currentBidMap.set(bidType, newBid);
    } else {
      this.currentBidMap.del(bidType);
      this.currentBidMap.set(bidType, currentBid);
    }
  },

  adminDraw: function (bidType) {
    // 管理员可以给未满的投注开奖，防止人数一直未满，一直开不了奖
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    var diceConfig = this.diceConfigMap.get(bidType);
    if (!diceConfig) {
      throw new Error("该投注类型并未设置，请选择已设置的投注类型！");
    }

    var currentBidPrice = diceConfig.bidPrice;

    // 当前投注数据
    var currentBid = this.currentBidMap.get(bidType);
    var size = currentBid.biders.length;
    if(size > 0){
      var winnerIndex = this.randomInt(size);
      var winner = currentBid.biders[winnerIndex];
      var totalAward = new BigNumber(currentBidPrice).mul(new BigNumber(size));
      totalAward = totalAward.mul(new BigNumber(10).pow(18));
      var winnerAward = totalAward.mul(new BigNumber(1).sub(new BigNumber(diceConfig.feeRate)));
      var result = Blockchain.transfer(winner, winnerAward);
      if (!result) {
        Event.Trigger("AdminWinnerTransferFailed", {
          Transfer: {
            from: Blockchain.transaction.to,
            to: winner,
            value: winnerAward.toString()
          }
        });

        throw new Error("Admin: Winner Award transfer failed. Winner Address:" + winner + ", NAS:" + winnerAward.toString() +
          ", BidType: " + bidType);
      }

      Event.Trigger("AdminWinnerTransferSuccess", {
        Transfer: {
          from: Blockchain.transaction.to,
          to: winner,
          value: winnerAward.toString()
        }
      });

      var commision = totalAward.sub(winnerAward);
      result = Blockchain.transfer(this.commisionAddress, commision);
      if (!result) {
        Event.Trigger("AdminCommisionTransferFailed", {
          Transfer: {
            from: Blockchain.transaction.to,
            to: this.commisionAddress,
            value: commision.toString()
          }
        });

        throw new Error("Admin: Commision transfer failed. Commision Address:" + this.commisionAddress + ", NAS:" + commision.toString() +
          ", BidType: " + bidType);
      }

      Event.Trigger("AdminCommisionTransferSuccess", {
        Transfer: {
          from: Blockchain.transaction.to,
          to: this.commisionAddress,
          value: commision.toString()
        }
      });

      currentBid.winner = winner;

      var index = this.historySize;
      var hash = Blockchain.transaction.hash;
      this.historyIndexMap.set(index, hash);
      this.historyBidMap.put(hash, currentBid);
      this.historySize += 1;

      var currentPeriod = currentBid.period;
      var period = currentPeriod + 1;
      var newBid = new Bid();
      newBid.period = period;
      newBid.type = bidType;
      var ts = Blockchain.transaction.timestamp;
      newBid.timestamp = ts;
      this.currentBidMap.del(bidType);
      this.currentBidMap.set(bidType, newBid);
    }

  },
  randomInt: function (max) {
    return Math.floor(Math.random() * Math.floor(max));
  },

  addConfig: function (bidType, bidPrice, bidTotal, feeRate) {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    var diceConfig = this.diceConfigMap.get(bidType);
    if (diceConfig) {
      throw new Error("该类型投注已经存在，请修改投注类型！");
    }
    var config = new DiceConfig();
    config.bidPrice = bidPrice;
    config.bidTotal = bidTotal;
    config.feeRate = feeRate;

    this.diceConfigMap.set(bidType, config);
    this.diceConfigArray.push(bidType);
  },

  changeFeeRate: function (bidType, newFeeRate) {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }
    var iFeeRate = parseInt(newFeeRate * 100);
    if(iFeeRate < 0){
      throw new Error("费率不能小于0");
    }

    if(iFeeRate > 10){
      throw new Error("费率不能大于0.1")
    }

    var diceConfig = this.diceConfigMap.get(bidType);
    if (!diceConfig) {
      throw new Error("该投注类型并未设置，请选择已设置的投注类型！");
    }
    diceConfig.feeRate = newFeeRate;
    this.diceConfigMap.del(bidType);
    this.diceConfigMap.set(bidType, diceConfig);
  },

  removeBidConfig: function (bidType) {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    var diceConfig = this.diceConfigMap.get(bidType);
    if (!diceConfig) {
      throw new Error("该投注类型并未设置，不能删除！");
    }

    var currentBid = this.currentBidMap.get(bidType);
    var size = currentBid.biders.length;
    if(size > 0){
      throw new Error("当前投注配置下有人投注，不能删除！");
    }else{
      this.diceConfigMap.del(bidType);
      var index = this.diceConfigArray.indexOf(bidType);
      if (index > -1) {
        this.diceConfigArray.splice(index, 1);
      }
    }
  },

  getBidConfig: function (bidType) {
    return this.diceConfigMap.get(bidType);
  },

  getAllBidConfig: function () {
    var length = this.diceConfigArray.length;
    var result = [];
    for(var i=0;i<length;i++){
      var type = this.diceConfigArray[i];
      var config = this.diceConfigMap.get(type);
      result.push(config);
    }

    return result;
  },

  getBidHistroy: function (limit, offset) {
    limit = parseInt(limit);
    offset = parseInt(offset);
    if (offset > this.size) {
      throw new Error("offset is not valid");
    }
    var number = offset + limit;
    if (number > this.size) {
      number = this.size;
    }
    var result = [];
    for (var i = offset; i < number; i++) {
      var key = this.historyIndexMap.get(i);
      var object = this.historyBidMap.get(key);
      result.push(object);
    }
    var obj = {};
    obj.bids = result;
    obj.size = this.historySize;
    return obj;
  },

  getHistorySize: function () {
    return this.historySize;
  },

  getCurrentBid: function (bidType) {
    return this.currentBidMap.get(bidType);
  },

  refund: function () {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    var dices = this.diceConfigArray.length;
    for (var i = 0; i < dices; i++) {

      var type = this.diceConfigArray[i];
      var currentBid = this.currentBidMap.get(type);
      var currentBiders = currentBid.biders;

      if (currentBiders && currentBiders.length > 0) {

        for (var j = 0; j < currentBiders.length; j++) {
          var to = currentBiders[j];
          var diceConfig = this.diceConfigMap.get(type);
          var value = diceConfig.bidPrice * 1.0;
          value = value.toFixed(5);
          var tranferValue = new BigNumber(value).mul(new BigNumber(10).pow(18));
          var result = Blockchain.transfer(to, tranferValue);

          if (!result) {
            Event.Trigger("RefundFailed", {
              Transfer: {
                from: Blockchain.transaction.to,
                to: to,
                value: tranferValue.toString()
              }
            });

            throw new Error("Refund Failed, to address:" + to + ", amount:" + tranferValue.toString());
          }

          Event.Trigger("RefundSuccess", {
            Transfer: {
              from: Blockchain.transaction.to,
              to: to,
              value: tranferValue.toString()
            }
          });
        }
      }
    }

    this._resetBid();
  },

  _resetBid: function () {
    var dices = this.diceConfigArray.length;
    for (var i = 0; i < dices; i++) {
      var type = this.diceConfigArray[i];
      var currentBid = this.currentBidMap.get(type);
      var period = currentBid.period;

      var newBid = new Bid();
      var newPeriod = period + 1;
      newBid.period = newPeriod;
      newBid.type = type;
      var ts = Blockchain.transaction.timestamp;
      newBid.timestamp = ts;
      this.currentBidMap.del(type);
      this.currentBidMap.set(type, newBid);
    }
  },

  withdraw: function (value) {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    var dices = this.diceConfigArray.length;
    for (var i = 0; i < dices; i++) {
      var type = this.diceConfigArray[i];
      var currentBid = this.currentBidMap.get(type);
      if (currentBid.biders && currentBid.biders.length > 0) {
        throw new Error("还有用户未退款，请先退款再提现！");
      }
    }

    value = new BigNumber(value);
    var tranferValue = value.mul(new BigNumber(10).pow(18));
    var result = Blockchain.transfer(this.commisionAddress, tranferValue);

    if (!result) {
      Event.Trigger("WithdrawFailed", {
        Transfer: {
          from: Blockchain.transaction.to,
          to: this.commisionAddress,
          value: tranferValue.toString()
        }
      });

      throw new Error("Withdraw Failed");
    }

    Event.Trigger("WithdrawSuccess", {
      Transfer: {
        from: Blockchain.transaction.to,
        to: this.commisionAddress,
        value: tranferValue.toString()
      }
    });
  },

  stop: function () {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }
    this.stoped = true;
  },

  begin: function () {
    var fromUser = Blockchain.transaction.from;
    if (fromUser != this.adminAddress) {
      throw new Error("没有权限")
    }

    this.stop = false;
  }

}

module.exports = BlockDiceContract;
