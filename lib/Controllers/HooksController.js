"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.HooksController = void 0;

var triggers = _interopRequireWildcard(require("../triggers"));

var Parse = _interopRequireWildcard(require("parse/node"));

var _request = _interopRequireDefault(require("../request"));

var _logger = require("../logger");

var _http = _interopRequireDefault(require("http"));

var _https = _interopRequireDefault(require("https"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function () { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

// -disable-next
// -disable-next
const DefaultHooksCollectionName = '_Hooks';
const HTTPAgents = {
  http: new _http.default.Agent({
    keepAlive: true
  }),
  https: new _https.default.Agent({
    keepAlive: true
  })
};

class HooksController {
  constructor(applicationId, databaseController, webhookKey) {
    this._applicationId = applicationId;
    this._webhookKey = webhookKey;
    this.database = databaseController;
  }

  load() {
    return this._getHooks().then(hooks => {
      hooks = hooks || [];
      hooks.forEach(hook => {
        this.addHookToTriggers(hook);
      });
    });
  }

  getFunction(functionName) {
    return this._getHooks({
      functionName: functionName
    }).then(results => results[0]);
  }

  getFunctions() {
    return this._getHooks({
      functionName: {
        $exists: true
      }
    });
  }

  getTrigger(className, triggerName) {
    return this._getHooks({
      className: className,
      triggerName: triggerName
    }).then(results => results[0]);
  }

  getTriggers() {
    return this._getHooks({
      className: {
        $exists: true
      },
      triggerName: {
        $exists: true
      }
    });
  }

  deleteFunction(functionName) {
    triggers.removeFunction(functionName, this._applicationId);
    return this._removeHooks({
      functionName: functionName
    });
  }

  deleteTrigger(className, triggerName) {
    triggers.removeTrigger(triggerName, className, this._applicationId);
    return this._removeHooks({
      className: className,
      triggerName: triggerName
    });
  }

  _getHooks(query = {}) {
    return this.database.find(DefaultHooksCollectionName, query).then(results => {
      return results.map(result => {
        delete result.objectId;
        return result;
      });
    });
  }

  _removeHooks(query) {
    return this.database.destroy(DefaultHooksCollectionName, query).then(() => {
      return Promise.resolve({});
    });
  }

  saveHook(hook) {
    var query;

    if (hook.functionName && hook.url) {
      query = {
        functionName: hook.functionName
      };
    } else if (hook.triggerName && hook.className && hook.url) {
      query = {
        className: hook.className,
        triggerName: hook.triggerName
      };
    } else {
      throw new Parse.Error(143, 'invalid hook declaration');
    }

    return this.database.update(DefaultHooksCollectionName, query, hook, {
      upsert: true
    }).then(() => {
      return Promise.resolve(hook);
    });
  }

  addHookToTriggers(hook) {
    var wrappedFunction = wrapToHTTPRequest(hook, this._webhookKey);
    wrappedFunction.url = hook.url;

    if (hook.className) {
      triggers.addTrigger(hook.triggerName, hook.className, wrappedFunction, this._applicationId);
    } else {
      triggers.addFunction(hook.functionName, wrappedFunction, null, this._applicationId);
    }
  }

  addHook(hook) {
    this.addHookToTriggers(hook);
    return this.saveHook(hook);
  }

  createOrUpdateHook(aHook) {
    var hook;

    if (aHook && aHook.functionName && aHook.url) {
      hook = {};
      hook.functionName = aHook.functionName;
      hook.url = aHook.url;
    } else if (aHook && aHook.className && aHook.url && aHook.triggerName && triggers.Types[aHook.triggerName]) {
      hook = {};
      hook.className = aHook.className;
      hook.url = aHook.url;
      hook.triggerName = aHook.triggerName;
    } else {
      throw new Parse.Error(143, 'invalid hook declaration');
    }

    return this.addHook(hook);
  }

  createHook(aHook) {
    if (aHook.functionName) {
      return this.getFunction(aHook.functionName).then(result => {
        if (result) {
          throw new Parse.Error(143, `function name: ${aHook.functionName} already exits`);
        } else {
          return this.createOrUpdateHook(aHook);
        }
      });
    } else if (aHook.className && aHook.triggerName) {
      return this.getTrigger(aHook.className, aHook.triggerName).then(result => {
        if (result) {
          throw new Parse.Error(143, `class ${aHook.className} already has trigger ${aHook.triggerName}`);
        }

        return this.createOrUpdateHook(aHook);
      });
    }

    throw new Parse.Error(143, 'invalid hook declaration');
  }

  updateHook(aHook) {
    if (aHook.functionName) {
      return this.getFunction(aHook.functionName).then(result => {
        if (result) {
          return this.createOrUpdateHook(aHook);
        }

        throw new Parse.Error(143, `no function named: ${aHook.functionName} is defined`);
      });
    } else if (aHook.className && aHook.triggerName) {
      return this.getTrigger(aHook.className, aHook.triggerName).then(result => {
        if (result) {
          return this.createOrUpdateHook(aHook);
        }

        throw new Parse.Error(143, `class ${aHook.className} does not exist`);
      });
    }

    throw new Parse.Error(143, 'invalid hook declaration');
  }

}

exports.HooksController = HooksController;

function wrapToHTTPRequest(hook, key) {
  return req => {
    const jsonBody = {};

    for (var i in req) {
      jsonBody[i] = req[i];
    }

    if (req.object) {
      jsonBody.object = req.object.toJSON();
      jsonBody.object.className = req.object.className;
    }

    if (req.original) {
      jsonBody.original = req.original.toJSON();
      jsonBody.original.className = req.original.className;
    }

    const jsonRequest = {
      url: hook.url,
      headers: {
        'Content-Type': 'application/json'
      },
      body: jsonBody,
      method: 'POST'
    };
    const agent = hook.url.startsWith('https') ? HTTPAgents['https'] : HTTPAgents['http'];
    jsonRequest.agent = agent;

    if (key) {
      jsonRequest.headers['X-Parse-Webhook-Key'] = key;
    } else {
      _logger.logger.warn('Making outgoing webhook request without webhookKey being set!');
    }

    return (0, _request.default)(jsonRequest).then(response => {
      let err;
      let result;
      let body = response.data;

      if (body) {
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (e) {
            err = {
              error: 'Malformed response',
              code: -1,
              partialResponse: body.substring(0, 100)
            };
          }
        }

        if (!err) {
          result = body.success;
          err = body.error;
        }
      }

      if (err) {
        throw err;
      } else if (hook.triggerName === 'beforeSave') {
        if (typeof result === 'object') {
          delete result.createdAt;
          delete result.updatedAt;
        }

        return {
          object: result
        };
      } else {
        return result;
      }
    });
  };
}

var _default = HooksController;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9Ib29rc0NvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsiRGVmYXVsdEhvb2tzQ29sbGVjdGlvbk5hbWUiLCJIVFRQQWdlbnRzIiwiaHR0cCIsIkFnZW50Iiwia2VlcEFsaXZlIiwiaHR0cHMiLCJIb29rc0NvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImFwcGxpY2F0aW9uSWQiLCJkYXRhYmFzZUNvbnRyb2xsZXIiLCJ3ZWJob29rS2V5IiwiX2FwcGxpY2F0aW9uSWQiLCJfd2ViaG9va0tleSIsImRhdGFiYXNlIiwibG9hZCIsIl9nZXRIb29rcyIsInRoZW4iLCJob29rcyIsImZvckVhY2giLCJob29rIiwiYWRkSG9va1RvVHJpZ2dlcnMiLCJnZXRGdW5jdGlvbiIsImZ1bmN0aW9uTmFtZSIsInJlc3VsdHMiLCJnZXRGdW5jdGlvbnMiLCIkZXhpc3RzIiwiZ2V0VHJpZ2dlciIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwiZ2V0VHJpZ2dlcnMiLCJkZWxldGVGdW5jdGlvbiIsInRyaWdnZXJzIiwicmVtb3ZlRnVuY3Rpb24iLCJfcmVtb3ZlSG9va3MiLCJkZWxldGVUcmlnZ2VyIiwicmVtb3ZlVHJpZ2dlciIsInF1ZXJ5IiwiZmluZCIsIm1hcCIsInJlc3VsdCIsIm9iamVjdElkIiwiZGVzdHJveSIsIlByb21pc2UiLCJyZXNvbHZlIiwic2F2ZUhvb2siLCJ1cmwiLCJQYXJzZSIsIkVycm9yIiwidXBkYXRlIiwidXBzZXJ0Iiwid3JhcHBlZEZ1bmN0aW9uIiwid3JhcFRvSFRUUFJlcXVlc3QiLCJhZGRUcmlnZ2VyIiwiYWRkRnVuY3Rpb24iLCJhZGRIb29rIiwiY3JlYXRlT3JVcGRhdGVIb29rIiwiYUhvb2siLCJUeXBlcyIsImNyZWF0ZUhvb2siLCJ1cGRhdGVIb29rIiwia2V5IiwicmVxIiwianNvbkJvZHkiLCJpIiwib2JqZWN0IiwidG9KU09OIiwib3JpZ2luYWwiLCJqc29uUmVxdWVzdCIsImhlYWRlcnMiLCJib2R5IiwibWV0aG9kIiwiYWdlbnQiLCJzdGFydHNXaXRoIiwibG9nZ2VyIiwid2FybiIsInJlc3BvbnNlIiwiZXJyIiwiZGF0YSIsIkpTT04iLCJwYXJzZSIsImUiLCJlcnJvciIsImNvZGUiLCJwYXJ0aWFsUmVzcG9uc2UiLCJzdWJzdHJpbmciLCJzdWNjZXNzIiwiY3JlYXRlZEF0IiwidXBkYXRlZEF0Il0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBRUE7O0FBRUE7O0FBRUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7Ozs7O0FBTkE7QUFFQTtBQU1BLE1BQU1BLDBCQUEwQixHQUFHLFFBQW5DO0FBQ0EsTUFBTUMsVUFBVSxHQUFHO0FBQ2pCQyxFQUFBQSxJQUFJLEVBQUUsSUFBSUEsY0FBS0MsS0FBVCxDQUFlO0FBQUVDLElBQUFBLFNBQVMsRUFBRTtBQUFiLEdBQWYsQ0FEVztBQUVqQkMsRUFBQUEsS0FBSyxFQUFFLElBQUlBLGVBQU1GLEtBQVYsQ0FBZ0I7QUFBRUMsSUFBQUEsU0FBUyxFQUFFO0FBQWIsR0FBaEI7QUFGVSxDQUFuQjs7QUFLTyxNQUFNRSxlQUFOLENBQXNCO0FBSzNCQyxFQUFBQSxXQUFXLENBQUNDLGFBQUQsRUFBd0JDLGtCQUF4QixFQUE0Q0MsVUFBNUMsRUFBd0Q7QUFDakUsU0FBS0MsY0FBTCxHQUFzQkgsYUFBdEI7QUFDQSxTQUFLSSxXQUFMLEdBQW1CRixVQUFuQjtBQUNBLFNBQUtHLFFBQUwsR0FBZ0JKLGtCQUFoQjtBQUNEOztBQUVESyxFQUFBQSxJQUFJLEdBQUc7QUFDTCxXQUFPLEtBQUtDLFNBQUwsR0FBaUJDLElBQWpCLENBQXNCQyxLQUFLLElBQUk7QUFDcENBLE1BQUFBLEtBQUssR0FBR0EsS0FBSyxJQUFJLEVBQWpCO0FBQ0FBLE1BQUFBLEtBQUssQ0FBQ0MsT0FBTixDQUFjQyxJQUFJLElBQUk7QUFDcEIsYUFBS0MsaUJBQUwsQ0FBdUJELElBQXZCO0FBQ0QsT0FGRDtBQUdELEtBTE0sQ0FBUDtBQU1EOztBQUVERSxFQUFBQSxXQUFXLENBQUNDLFlBQUQsRUFBZTtB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QUFBLGVBQWUsRUFBRWQsSUFBSSxDQUFDZSxTQUFMLENBQWUsQ0FBZixFQUFrQixHQUFsQjtBQUhiLGFBQU47QUFLRDtBQUNGOztBQUNELFlBQUksQ0FBQ1IsR0FBTCxFQUFVO0FBQ1JyQyxVQUFBQSxNQUFNLEdBQUc4QixJQUFJLENBQUNnQixPQUFkO0FBQ0FULFVBQUFBLEdBQUcsR0FBR1AsSUFBSSxDQUFDWSxLQUFYO0FBQ0Q7QUFDRjs7QUFDRCxVQUFJTCxHQUFKLEVBQVM7QUFDUCxjQUFNQSxHQUFOO0FBQ0QsT0FGRCxNQUVPLElBQUl6RCxJQUFJLENBQUNTLFdBQUwsS0FBcUIsWUFBekIsRUFBdUM7QUFDNUMsWUFBSSxPQUFPVyxNQUFQLEtBQWtCLFFBQXRCLEVBQWdDO0FBQzlCLGlCQUFPQSxNQUFNLENBQUMrQyxTQUFkO0FBQ0EsaUJBQU8vQyxNQUFNLENBQUNnRCxTQUFkO0FBQ0Q7O0FBQ0QsZUFBTztBQUFFdkIsVUFBQUEsTUFBTSxFQUFFekI7QUFBVixTQUFQO0FBQ0QsT0FOTSxNQU1BO0FBQ0wsZUFBT0EsTUFBUDtBQUNEO0FBQ0YsS0FoQ00sQ0FBUDtBQWlDRCxHQW5FRDtBQW9FRDs7ZUFFY2pDLGUiLCJzb3VyY2VzQ29udGVudCI6WyIvKiogQGZsb3cgd2VhayAqL1xuXG5pbXBvcnQgKiBhcyB0cmlnZ2VycyBmcm9tICcuLi90cmlnZ2Vycyc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCAqIGFzIFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgcmVxdWVzdCBmcm9tICcuLi9yZXF1ZXN0JztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgaHR0cCBmcm9tICdodHRwJztcbmltcG9ydCBodHRwcyBmcm9tICdodHRwcyc7XG5cbmNvbnN0IERlZmF1bHRIb29rc0NvbGxlY3Rpb25OYW1lID0gJ19Ib29rcyc7XG5jb25zdCBIVFRQQWdlbnRzID0ge1xuICBodHRwOiBuZXcgaHR0cC5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSB9KSxcbiAgaHR0cHM6IG5ldyBodHRwcy5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSB9KSxcbn07XG5cbmV4cG9ydCBjbGFzcyBIb29rc0NvbnRyb2xsZXIge1xuICBfYXBwbGljYXRpb25JZDogc3RyaW5nO1xuICBfd2ViaG9va0tleTogc3RyaW5nO1xuICBkYXRhYmFzZTogYW55O1xuXG4gIGNvbnN0cnVjdG9yKGFwcGxpY2F0aW9uSWQ6IHN0cmluZywgZGF0YWJhc2VDb250cm9sbGVyLCB3ZWJob29rS2V5KSB7XG4gICAgdGhpcy5fYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQ7XG4gICAgdGhpcy5fd2ViaG9va0tleSA9IHdlYmhvb2tLZXk7XG4gICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlQ29udHJvbGxlcjtcbiAgfVxuXG4gIGxvYWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKCkudGhlbihob29rcyA9PiB7XG4gICAgICBob29rcyA9IGhvb2tzIHx8IFtdO1xuICAgICAgaG9va3MuZm9yRWFjaChob29rID0+IHtcbiAgICAgICAgdGhpcy5hZGRIb29rVG9UcmlnZ2Vycyhob29rKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZ2V0RnVuY3Rpb24oZnVuY3Rpb25OYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKHsgZnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUgfSkudGhlbihcbiAgICAgIHJlc3VsdHMgPT4gcmVzdWx0c1swXVxuICAgICk7XG4gIH1cblxuICBnZXRGdW5jdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKHsgZnVuY3Rpb25OYW1lOiB7ICRleGlzdHM6IHRydWUgfSB9KTtcbiAgfVxuXG4gIGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9nZXRIb29rcyh7XG4gICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyTmFtZSxcbiAgICB9KS50aGVuKHJlc3VsdHMgPT4gcmVzdWx0c1swXSk7XG4gIH1cblxuICBnZXRUcmlnZ2VycygpIHtcbiAgICByZXR1cm4gdGhpcy5fZ2V0SG9va3Moe1xuICAgICAgY2xhc3NOYW1lOiB7ICRleGlzdHM6IHRydWUgfSxcbiAgICAgIHRyaWdnZXJOYW1lOiB7ICRleGlzdHM6IHRydWUgfSxcbiAgICB9KTtcbiAgfVxuXG4gIGRlbGV0ZUZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSkge1xuICAgIHRyaWdnZXJzLnJlbW92ZUZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgdGhpcy5fYXBwbGljYXRpb25JZCk7XG4gICAgcmV0dXJuIHRoaXMuX3JlbW92ZUhvb2tzKHsgZnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUgfSk7XG4gIH1cblxuICBkZWxldGVUcmlnZ2VyKGNsYXNzTmFtZSwgdHJpZ2dlck5hbWUpIHtcbiAgICB0cmlnZ2Vycy5yZW1vdmVUcmlnZ2VyKHRyaWdnZXJOYW1lLCBjbGFzc05hbWUsIHRoaXMuX2FwcGxpY2F0aW9uSWQpO1xuICAgIHJldHVybiB0aGlzLl9yZW1vdmVIb29rcyh7XG4gICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyTmFtZSxcbiAgICB9KTtcbiAgfVxuXG4gIF9nZXRIb29rcyhxdWVyeSA9IHt9KSB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VcbiAgICAgIC5maW5kKERlZmF1bHRIb29rc0NvbGxlY3Rpb25OYW1lLCBxdWVyeSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAocmVzdWx0ID0+IHtcbiAgICAgICAgICBkZWxldGUgcmVzdWx0Lm9iamVjdElkO1xuICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBfcmVtb3ZlSG9va3MocXVlcnkpIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZS5kZXN0cm95KERlZmF1bHRIb29rc0NvbGxlY3Rpb25OYW1lLCBxdWVyeSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHt9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHNhdmVIb29rKGhvb2spIHtcbiAgICB2YXIgcXVlcnk7XG4gICAgaWYgKGhvb2suZnVuY3Rpb25OYW1lICYmIGhvb2sudXJsKSB7XG4gICAgICBxdWVyeSA9IHsgZnVuY3Rpb25OYW1lOiBob29rLmZ1bmN0aW9uTmFtZSB9O1xuICAgIH0gZWxzZSBpZiAoaG9vay50cmlnZ2VyTmFtZSAmJiBob29rLmNsYXNzTmFtZSAmJiBob29rLnVybCkge1xuICAgICAgcXVlcnkgPSB7IGNsYXNzTmFtZTogaG9vay5jbGFzc05hbWUsIHRyaWdnZXJOYW1lOiBob29rLnRyaWdnZXJOYW1lIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxNDMsICdpbnZhbGlkIGhvb2sgZGVjbGFyYXRpb24nKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VcbiAgICAgIC51cGRhdGUoRGVmYXVsdEhvb2tzQ29sbGVjdGlvbk5hbWUsIHF1ZXJ5LCBob29rLCB7IHVwc2VydDogdHJ1ZSB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGhvb2spO1xuICAgICAgfSk7XG4gIH1cblxuICBhZGRIb29rVG9UcmlnZ2Vycyhob29rKSB7XG4gICAgdmFyIHdyYXBwZWRGdW5jdGlvbiA9IHdyYXBUb0hUVFBSZXF1ZXN0KGhvb2ssIHRoaXMuX3dlYmhvb2tLZXkpO1xuICAgIHdyYXBwZWRGdW5jdGlvbi51cmwgPSBob29rLnVybDtcbiAgICBpZiAoaG9vay5jbGFzc05hbWUpIHtcbiAgICAgIHRyaWdnZXJzLmFkZFRyaWdnZXIoXG4gICAgICAgIGhvb2sudHJpZ2dlck5hbWUsXG4gICAgICAgIGhvb2suY2xhc3NOYW1lLFxuICAgICAgICB3cmFwcGVkRnVuY3Rpb24sXG4gICAgICAgIHRoaXMuX2FwcGxpY2F0aW9uSWRcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRyaWdnZXJzLmFkZEZ1bmN0aW9uKFxuICAgICAgICBob29rLmZ1bmN0aW9uTmFtZSxcbiAgICAgICAgd3JhcHBlZEZ1bmN0aW9uLFxuICAgICAgICBudWxsLFxuICAgICAgICB0aGlzLl9hcHBsaWNhdGlvbklkXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGFkZEhvb2soaG9vaykge1xuICAgIHRoaXMuYWRkSG9va1RvVHJpZ2dlcnMoaG9vayk7XG4gICAgcmV0dXJuIHRoaXMuc2F2ZUhvb2soaG9vayk7XG4gIH1cblxuICBjcmVhdGVPclVwZGF0ZUhvb2soYUhvb2spIHtcbiAgICB2YXIgaG9vaztcbiAgICBpZiAoYUhvb2sgJiYgYUhvb2suZnVuY3Rpb25OYW1lICYmIGFIb29rLnVybCkge1xuICAgICAgaG9vayA9IHt9O1xuICAgICAgaG9vay5mdW5jdGlvbk5hbWUgPSBhSG9vay5mdW5jdGlvbk5hbWU7XG4gICAgICBob29rLnVybCA9IGFIb29rLnVybDtcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgYUhvb2sgJiZcbiAgICAgIGFIb29rLmNsYXNzTmFtZSAmJlxuICAgICAgYUhvb2sudXJsICYmXG4gICAgICBhSG9vay50cmlnZ2VyTmFtZSAmJlxuICAgICAgdHJpZ2dlcnMuVHlwZXNbYUhvb2sudHJpZ2dlck5hbWVdXG4gICAgKSB7XG4gICAgICBob29rID0ge307XG4gICAgICBob29rLmNsYXNzTmFtZSA9IGFIb29rLmNsYXNzTmFtZTtcbiAgICAgIGhvb2sudXJsID0gYUhvb2sudXJsO1xuICAgICAgaG9vay50cmlnZ2VyTmFtZSA9IGFIb29rLnRyaWdnZXJOYW1lO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTQzLCAnaW52YWxpZCBob29rIGRlY2xhcmF0aW9uJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWRkSG9vayhob29rKTtcbiAgfVxuXG4gIGNyZWF0ZUhvb2soYUhvb2spIHtcbiAgICBpZiAoYUhvb2suZnVuY3Rpb25OYW1lKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRGdW5jdGlvbihhSG9vay5mdW5jdGlvbk5hbWUpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIDE0MyxcbiAgICAgICAgICAgIGBmdW5jdGlvbiBuYW1lOiAke2FIb29rLmZ1bmN0aW9uTmFtZX0gYWxyZWFkeSBleGl0c2BcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZU9yVXBkYXRlSG9vayhhSG9vayk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoYUhvb2suY2xhc3NOYW1lICYmIGFIb29rLnRyaWdnZXJOYW1lKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRUcmlnZ2VyKGFIb29rLmNsYXNzTmFtZSwgYUhvb2sudHJpZ2dlck5hbWUpLnRoZW4oXG4gICAgICAgIHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAxNDMsXG4gICAgICAgICAgICAgIGBjbGFzcyAke2FIb29rLmNsYXNzTmFtZX0gYWxyZWFkeSBoYXMgdHJpZ2dlciAke2FIb29rLnRyaWdnZXJOYW1lfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZU9yVXBkYXRlSG9vayhhSG9vayk7XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgJ2ludmFsaWQgaG9vayBkZWNsYXJhdGlvbicpO1xuICB9XG5cbiAgdXBkYXRlSG9vayhhSG9vaykge1xuICAgIGlmIChhSG9vay5mdW5jdGlvbk5hbWUpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldEZ1bmN0aW9uKGFIb29rLmZ1bmN0aW9uTmFtZSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlT3JVcGRhdGVIb29rKGFIb29rKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgMTQzLFxuICAgICAgICAgIGBubyBmdW5jdGlvbiBuYW1lZDogJHthSG9vay5mdW5jdGlvbk5hbWV9IGlzIGRlZmluZWRgXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGFIb29rLmNsYXNzTmFtZSAmJiBhSG9vay50cmlnZ2VyTmFtZSkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0VHJpZ2dlcihhSG9vay5jbGFzc05hbWUsIGFIb29rLnRyaWdnZXJOYW1lKS50aGVuKFxuICAgICAgICByZXN1bHQgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZU9yVXBkYXRlSG9vayhhSG9vayk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxNDMsIGBjbGFzcyAke2FIb29rLmNsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3RgKTtcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgJ2ludmFsaWQgaG9vayBkZWNsYXJhdGlvbicpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHdyYXBUb0hUVFBSZXF1ZXN0KGhvb2ssIGtleSkge1xuICByZXR1cm4gcmVxID0+IHtcbiAgICBjb25zdCBqc29uQm9keSA9IHt9O1xuICAgIGZvciAodmFyIGkgaW4gcmVxKSB7XG4gICAgICBqc29uQm9keVtpXSA9IHJlcVtpXTtcbiAgICB9XG4gICAgaWYgKHJlcS5vYmplY3QpIHtcbiAgICAgIGpzb25Cb2R5Lm9iamVjdCA9IHJlcS5vYmplY3QudG9KU09OKCk7XG4gICAgICBqc29uQm9keS5vYmplY3QuY2xhc3NOYW1lID0gcmVxLm9iamVjdC5jbGFzc05hbWU7XG4gICAgfVxuICAgIGlmIChyZXEub3JpZ2luYWwpIHtcbiAgICAgIGpzb25Cb2R5Lm9yaWdpbmFsID0gcmVxLm9yaWdpbmFsLnRvSlNPTigpO1xuICAgICAganNvbkJvZHkub3JpZ2luYWwuY2xhc3NOYW1lID0gcmVxLm9yaWdpbmFsLmNsYXNzTmFtZTtcbiAgICB9XG4gICAgY29uc3QganNvblJlcXVlc3Q6IGFueSA9IHtcbiAgICAgIHVybDogaG9vay51cmwsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keToganNvbkJvZHksXG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICB9O1xuXG4gICAgY29uc3QgYWdlbnQgPSBob29rLnVybC5zdGFydHNXaXRoKCdodHRwcycpXG4gICAgICA/IEhUVFBBZ2VudHNbJ2h0dHBzJ11cbiAgICAgIDogSFRUUEFnZW50c1snaHR0cCddO1xuICAgIGpzb25SZXF1ZXN0LmFnZW50ID0gYWdlbnQ7XG5cbiAgICBpZiAoa2V5KSB7XG4gICAgICBqc29uUmVxdWVzdC5oZWFkZXJzWydYLVBhcnNlLVdlYmhvb2stS2V5J10gPSBrZXk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAnTWFraW5nIG91dGdvaW5nIHdlYmhvb2sgcmVxdWVzdCB3aXRob3V0IHdlYmhvb2tLZXkgYmVpbmcgc2V0ISdcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiByZXF1ZXN0KGpzb25SZXF1ZXN0KS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgIGxldCBlcnI7XG4gICAgICBsZXQgcmVzdWx0O1xuICAgICAgbGV0IGJvZHkgPSByZXNwb25zZS5kYXRhO1xuICAgICAgaWYgKGJvZHkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBib2R5ID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBlcnIgPSB7XG4gICAgICAgICAgICAgIGVycm9yOiAnTWFsZm9ybWVkIHJlc3BvbnNlJyxcbiAgICAgICAgICAgICAgY29kZTogLTEsXG4gICAgICAgICAgICAgIHBhcnRpYWxSZXNwb25zZTogYm9keS5zdWJzdHJpbmcoMCwgMTAwKSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYm9keS5zdWNjZXNzO1xuICAgICAgICAgIGVyciA9IGJvZHkuZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSBlbHNlIGlmIChob29rLnRyaWdnZXJOYW1lID09PSAnYmVmb3JlU2F2ZScpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgZGVsZXRlIHJlc3VsdC5jcmVhdGVkQXQ7XG4gICAgICAgICAgZGVsZXRlIHJlc3VsdC51cGRhdGVkQXQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgb2JqZWN0OiByZXN1bHQgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IEhvb2tzQ29udHJvbGxlcjtcbiJdfQ==