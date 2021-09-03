const _ = require('underscore');

const Beautifier = require('./beautifier');

const BinanceErrors = Object.freeze({
  INVALID_LISTEN_KEY: -1125
});

class BinanceWS {
  constructor(beautify = true, isBrowser = false) {
    if (isBrowser) {
      this.WebSocket = WebSocket;
    } else {
      this.WebSocket = require('ws');
    }
    this._isBrowser = isBrowser;
    this._baseUrl = 'wss://stream.binance.com:9443/ws/';
    this._combinedBaseUrl = 'wss://stream.binance.com:9443/stream?streams=';
    this._sockets = {};
    this._beautifier = new Beautifier();
    this._beautify = beautify;

    this.streams = {
      depth: symbol => `${symbol.toLowerCase()}@depth`,
      depthLevel: (symbol, level) =>
        `${symbol.toLowerCase()}@depth${level}`,
      kline: (symbol, interval) =>
        `${symbol.toLowerCase()}@kline_${interval}`,
      aggTrade: symbol => `${symbol.toLowerCase()}@aggTrade`,
      bookTicker: symbol => `${symbol.toLowerCase()}@bookTicker`,
      trade: symbol => `${symbol.toLowerCase()}@trade`,
      ticker: symbol => `${symbol.toLowerCase()}@ticker`,
      allTickers: () => '!ticker@arr'
    };

    // Reference to the setInterval timer for sending keep alive requests in onUserData
    this._userDataRefresh = {
      intervaId: false,
      failCount: 0
    };
  }

  _handleSocketOnMessage(message, eventHandler, isCombined) {
    let event;
    try {
      event = JSON.parse(message);
    } catch (e) {
      event = message;
    }
    if (this._beautify) {
      if (event.stream) {
        let splitPos = event.stream.indexOf('@');
        let eventName = event.stream;
        if (splitPos !== -1) {
          eventName = event.stream.substr(splitPos + 1);
        }
        event.type = eventName;
        event.data = this._beautifyResponse(event.data, eventName, isCombined);
      } else {
        event = this._beautifyResponse(event);
      }
    }

    eventHandler(event);
  }

  _setupWebSocket(eventHandler, path, isCombined) {
    var inst = this;
    if (this._sockets[path]) {
      return this._sockets[path];
    }
    path = (isCombined ? this._combinedBaseUrl : this._baseUrl) + path;
    const ws = new this.WebSocket(path);

    if (this._isBrowser) {
      ws.onmessage = function (message) {
        inst._handleSocketOnMessage(message.data, eventHandler, isCombined);
      };
      ws.onerror = function (e) {
        console.error(
          new Date(),
          'WebSocket onerror',
          e
        );
      };
    } else {
      ws.on('message', message => {
        inst._handleSocketOnMessage(message, eventHandler, isCombined);
      });
      ws.on('error', () => {
        // node.js EventEmitters will throw and then exit if no error listener is registered
      });
    }

    this.ws = ws;
    return ws;
  }

  _beautifyResponse(data, event, isCombined) {
    if (_.isArray(data)) {
      return _.map(data, event => {
        if (event.e) {
          return this._beautifier.beautify(event, event.e + 'Event');
        }
        return event;
      });
    } else if (data.e) {
      return this._beautifier.beautify(data, data.e + 'Event');
    } else if (isCombined && _.isObject(data)) {
      return this._beautifier.beautify(data, event);
    }
    return data;
  }

  _clearUserDataInterval() {
    if (this._userDataRefresh.intervaId) {
      clearInterval(this._userDataRefresh.intervaId);
    }

    this._userDataRefresh.intervaId = false;
    this._userDataRefresh.failCount = 0;
  }

  _sendUserDataKeepAlive(binanceRest, response) {
    return binanceRest.keepAliveUserDataStream(response).catch(e => {
      this._userDataRefresh.failCount++;
      const msg =
        'Failed requesting keepAliveUserDataStream for onUserData listener';
      if (e && e.code === BinanceErrors.INVALID_LISTEN_KEY) {
        console.error(
          new Date(),
          msg,
          'listen key expired - clearing keepAlive interval',
          e
        );
        this._clearUserDataInterval();
        return;
      }
      console.error(
        new Date(),
        msg,
        'failCount: ',
        this._userDataRefresh.failCount,
        e
      );
    });
  }

  closeSocket() {
    return this.ws.close();
  }

  onDepthUpdate(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.depth(symbol));
  }

  onDepthLevelUpdate(symbol, level, eventHandler) {
    return this._setupWebSocket(
      eventHandler,
      this.streams.depthLevel(symbol, level)
    );
  }

  onKline(symbol, interval, eventHandler) {
    return this._setupWebSocket(
      eventHandler,
      this.streams.kline(symbol, interval)
    );
  }

  onAggTrade(symbol, eventHandler) {
    return this._setupWebSocket(
      eventHandler,
      this.streams.aggTrade(symbol)
    );
  }

  onBookTicker(symbol, eventHandler) {
    return this._setupWebSocket(
      eventHandler,
      this.streams.bookTicker(symbol)
    );
  }

  onTrade(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.trade(symbol));
  }

  onTicker(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.ticker(symbol));
  }

  onAllTickers(eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.allTickers());
  }

  onUserData(binanceRest, eventHandler, interval = 60000) {
    this._clearUserDataInterval();
    return binanceRest.startUserDataStream().then(response => {
      this._userDataRefresh.intervaId = setInterval(
        () => this._sendUserDataKeepAlive(binanceRest, response),
        interval
      );
      this._userDataRefresh.failCount = 0;

      return this._setupWebSocket(eventHandler, response.listenKey);
    });
  }

  onCombinedStream(streams, eventHandler) {
    return this._setupWebSocket(eventHandler, streams.join('/'), true);
  }
}

module.exports = BinanceWS;
