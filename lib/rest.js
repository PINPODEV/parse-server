"use strict";

// This file contains helpers for running operations in REST format.
// The goal is that handlers that explicitly handle an express route
// should just be shallow wrappers around things in this file, but
// these functions should not explicitly depend on the request
// object.
// This means that one of these handlers can support multiple
// routes. That's useful for the routes that do really similar
// things.
var Parse = require('parse/node').Parse;

var RestQuery = require('./RestQuery');

var RestWrite = require('./RestWrite');

var triggers = require('./triggers');

function checkTriggers(className, config, types) {
  return types.some(triggerType => {
    return triggers.getTrigger(className, triggers.Types[triggerType], config.applicationId);
  });
}

function checkLiveQuery(className, config) {
  return config.liveQueryController && config.liveQueryController.hasLiveQuery(className);
} // Returns a promise for an object with optional keys 'results' and 'count'.


function find(config, auth, className, restWhere, restOptions, clientSDK) {
  enforceRoleSecurity('find', className, auth);
  return triggers.maybeRunQueryTrigger(triggers.Types.beforeFind, className, restWhere, restOptions, config, auth).then(result => {
    restWhere = result.restWhere || restWhere;
    restOptions = result.restOptions || restOptions;
    const query = new RestQuery(config, auth, className, restWhere, restOptions, clientSDK);
    return query.execute();
  });
} // get is just like find but only queries an objectId.


const get = (config, auth, className, objectId, restOptions, clientSDK) => {
  var restWhere = {
    objectId
  };
  enforceRoleSecurity('get', className, auth);
  return triggers.maybeRunQueryTrigger(triggers.Types.beforeFind, className, restWhere, restOptions, config, auth, true).then(result => {
    restWhere = result.restWhere || restWhere;
    restOptions = result.restOptions || restOptions;
    const query = new RestQuery(config, auth, className, restWhere, restOptions, clientSDK);
    return query.execute();
  });
}; // Returns a promise that doesn't resolve to any useful value.


function del(config, auth, className, objectId) {
  if (typeof objectId !== 'string') {
    throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad objectId');
  }

  if (className === '_User' && auth.isUnauthenticated()) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Insufficient auth to delete user');
  }

  enforceRoleSecurity('delete', className, auth);
  let inflatedObject;
  let schemaController;
  return Promise.resolve().then(() => {
    const hasTriggers = checkTriggers(className, config, ['beforeDelete', 'afterDelete']);
    const hasLiveQuery = checkLiveQuery(className, config);

    if (hasTriggers || hasLiveQuery || className == '_Session') {
      return new RestQuery(config, auth, className, {
        objectId
      }).execute({
        op: 'delete'
      }).then(response => {
        if (response && response.results && response.results.length) {
          const firstResult = response.results[0];
          firstResult.className = className;

          if (className === '_Session' && !auth.isMaster) {
            if (!auth.user || firstResult.user.objectId !== auth.user.id) {
              throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
            }
          }

          var cacheAdapter = config.cacheController;
          cacheAdapter.user.del(firstResult.sessionToken);
          inflatedObject = Parse.Object.fromJSON(firstResult);
          return triggers.maybeRunTrigger(triggers.Types.beforeDelete, auth, inflatedObject, null, config);
        }

        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for delete.');
      });
    }

    return Promise.resolve({});
  }).then(() => {
    if (!auth.isMaster) {
      return auth.getUserRoles();
    } else {
      return;
    }
  }).then(() => config.database.loadSchema()).then(s => {
    schemaController = s;
    const options = {};

    if (!auth.isMaster) {
      options.acl = ['*'];

      if (auth.user) {
        options.acl.push(auth.user.id);
        options.acl = options.acl.concat(auth.userRoles);
      }
    }

    return config.database.destroy(className, {
      objectId: objectId
    }, options, schemaController);
  }).then(() => {
    // Notify LiveQuery server if possible
    const perms = schemaController.getClassLevelPermissions(className);
    config.liveQueryController.onAfterDelete(className, inflatedObject, null, perms);
    return triggers.maybeRunTrigger(triggers.Types.afterDelete, auth, inflatedObject, null, config);
  }).catch(error => {
    handleSessionMissingError(error, className, auth);
  });
} // Returns a promise for a {response, status, location} object.


function create(config, auth, className, restObject, clientSDK) {
  enforceRoleSecurity('create', className, auth);
  var write = new RestWrite(config, auth, className, null, restObject, null, clientSDK);
  return write.execute();
} // Returns a promise that contains the fields of the update that the
// REST API is supposed to return.
// Usually, this is just updatedAt.


function update(config, auth, className, restWhere, restObject, clientSDK) {
  enforceRoleSecurity('update', className, auth);
  return Promise.resolve().then(() => {
    const hasTriggers = checkTriggers(className, config, ['beforeSave', 'afterSave']);
    const hasLiveQuery = checkLiveQuery(className, config);

    if (hasTriggers || hasLiveQuery) {
      // Do not use find, as it runs the before finds
      return new RestQuery(config, auth, className, restWhere, undefined, undefined, false).execute({
        op: 'update'
      });
    }

    return Promise.resolve({});
  }).then(({
    results
  }) => {
    var originalRestObject;

    if (results && results.length) {
      originalRestObject = results[0];
    }

    return new RestWrite(config, auth, className, restWhere, restObject, originalRestObject, clientSDK, 'update').execute();
  }).catch(error => {
    handleSessionMissingError(error, className, auth);
  });
}

function handleSessionMissingError(error, className, auth) {
  // If we're trying to update a user without / with bad session token
  if (className === '_User' && error.code === Parse.Error.OBJECT_NOT_FOUND && !auth.isMaster) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Insufficient auth.');
  }

  throw error;
}

const classesWithMasterOnlyAccess = ['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule']; // Disallowing access to the _Role collection except by master key

function enforceRoleSecurity(method, className, auth) {
  if (className === '_Installation' && !auth.isMaster) {
    if (method === 'delete' || method === 'find') {
      const error = `Clients aren't allowed to perform the ${method} operation on the installation collection.`;
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
    }
  } //all volatileClasses are masterKey only


  if (classesWithMasterOnlyAccess.indexOf(className) >= 0 && !auth.isMaster) {
    const error = `Clients aren't allowed to perform the ${method} operation on the ${className} collection.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  } // readOnly masterKey is not allowed


  if (auth.isReadOnly && (method === 'delete' || method === 'create' || method === 'update')) {
    const error = `read-only masterKey isn't allowed to perform the ${method} operation.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  }
}

module.exports = {
  create,
  del,
  find,
  get,
  update
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsIlJlc3RRdWVyeSIsIlJlc3RXcml0ZSIsInRyaWdnZXJzIiwiY2hlY2tUcmlnZ2VycyIsImNsYXNzTmFtZSIsImNvbmZpZyIsInR5cGVzIiwic29tZSIsInRyaWdnZXJUeXBlIiwiZ2V0VHJpZ2dlciIsIlR5cGVzIiwiYXBwbGljYXRpb25JZCIsImNoZWNrTGl2ZVF1ZXJ5IiwibGl2ZVF1ZXJ5Q29udHJvbGxlciIsImhhc0xpdmVRdWVyeSIsImZpbmQiLCJhdXRoIiwicmVzdFdoZXJlIiwicmVzdE9wdGlvbnMiLCJjbGllbnRTREsiLCJlbmZvcmNlUm9sZVNlY3VyaXR5IiwibWF5YmVSdW5RdWVyeVRyaWdnZXIiLCJiZWZvcmVGaW5kIiwidGhlbiIsInJlc3VsdCIsInF1ZXJ5IiwiZXhlY3V0ZSIsImdldCIsIm9iamVjdElkIiwiZGVsIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJpc1VuYXV0aGVudGljYXRlZCIsIlNFU1NJT05fTUlTU0lORyIsImluZmxhdGVkT2JqZWN0Iiwic2NoZW1hQ29udHJvbGxlciIsIlByb21pc2UiLCJyZXNvbHZlIiwiaGFzVHJpZ2dlcnMiLCJvcCIsInJlc3BvbnNlIiwicmVzdWx0cyIsImxlbmd0aCIsImZpcnN0UmVzdWx0IiwiaXNNYXN0ZXIiLCJ1c2VyIiwiaWQiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJjYWNoZUFkYXB0ZXIiLCJjYWNoZUNvbnRyb2xsZXIiLCJzZXNzaW9uVG9rZW4iLCJPYmplY3QiLCJmcm9tSlNPTiIsIm1heWJlUnVuVHJpZ2dlciIsImJlZm9yZURlbGV0ZSIsIk9CSkVDVF9OT1RfRk9VTkQiLCJnZXRVc2VyUm9sZXMiLCJkYXRhYmFzZSIsImxvYWRTY2hlbWEiLCJzIiwib3B0aW9ucyIsImFjbCIsInB1c2giLCJjb25jYXQiLCJ1c2VyUm9sZXMiLCJkZXN0cm95IiwicGVybXMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJvbkFmdGVyRGVsZXRlIiwiYWZ0ZXJEZWxldGUiLCJjYXRjaCIsImVycm9yIiwiaGFuZGxlU2Vzc2lvbk1pc3NpbmdFcnJvciIsImNyZWF0ZSIsInJlc3RPYmplY3QiLCJ3cml0ZSIsInVwZGF0ZSIsInVuZGVmaW5lZCIsIm9yaWdpbmFsUmVzdE9iamVjdCIsImNvZGUiLCJjbGFzc2VzV2l0aE1hc3Rlck9ubHlBY2Nlc3MiLCJtZXRob2QiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiaW5kZXhPZiIsImlzUmVhZE9ubHkiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFFQSxJQUFJQSxLQUFLLEdBQUdDLE9BQU8sQ0FBQyxZQUFELENBQVAsQ0FBc0JELEtBQWxDOztBQUVBLElBQUlFLFNBQVMsR0FBR0QsT0FBTyxDQUFDLGFBQUQsQ0FBdkI7O0FBQ0EsSUFBSUUsU0FBUyxHQUFHRixPQUFPLENBQUMsYUFBRCxDQUF2Qjs7QUFDQSxJQUFJRyxRQUFRLEdBQUdILE9BQU8sQ0FBQyxZQUFELENBQXRCOztBQUVBLFNBQVNJLGFBQVQsQ0FBdUJDLFNBQXZCLEVBQWtDQyxNQUFsQyxFQUEwQ0MsS0FBMUMsRUFBaUQ7QUFDL0MsU0FBT0EsS0FBSyxDQUFDQyxJQUFOLENBQVdDLFdBQVcsSUFBSTtBQUMvQixXQUFPTixRQUFRLENBQUNPLFVBQVQsQ0FDTEwsU0FESyxFQUVMRixRQUFRLENBQUNRLEtBQVQsQ0FBZUYsV0FBZixDQUZLLEVBR0xILE1BQU0sQ0FBQ00sYUFIRixDQUFQO0FBS0QsR0FOTSxDQUFQO0FBT0Q7O0FBRUQsU0FBU0MsY0FBVCxDQUF3QlIsU0FBeEIsRUFBbUNDLE1BQW5DLEVBQTJDO0FBQ3pDLFNBQ0VBLE1BQU0sQ0FBQ1EsbUJBQVAsSUFDQVIsTUFBTSxDQUFDUSxtQkFBUCxDQUEyQkMsWUFBM0IsQ0FBd0NWLFNBQXhDLENBRkY7QUFJRCxDLENBRUQ7OztBQUNBLFNBQVNXLElBQVQsQ0FB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Q0csT0FBNUIsQ0FBb0MvRSxTQUFwQyxLQUFrRCxDQUFsRCxJQUF1RCxDQUFDWSxJQUFJLENBQUM0QixRQUFqRSxFQUEyRTtBQUN6RSxVQUFNMkIsS0FBSyxHQUFJLHlDQUF3Q1UsTUFBTyxxQkFBb0I3RSxTQUFVLGNBQTVGO0FBQ0EsVUFBTSxJQUFJTixLQUFLLENBQUNnQyxLQUFWLENBQWdCaEMsS0FBSyxDQUFDZ0MsS0FBTixDQUFZb0QsbUJBQTVCLEVBQWlEWCxLQUFqRCxDQUFOO0FBQ0QsR0FabUQsQ0FjcEQ7OztBQUNBLE1BQ0V2RCxJQUFJLENBQUNvRSxVQUFMLEtBQ0NILE1BQU0sS0FBSyxRQUFYLElBQXVCQSxNQUFNLEtBQUssUUFBbEMsSUFBOENBLE1BQU0sS0FBSyxRQUQxRCxDQURGLEVBR0U7QUFDQSxVQUFNVixLQUFLLEdBQUksb0RBQW1EVSxNQUFPLGFBQXpFO0FBQ0EsVUFBTSxJQUFJbkYsS0FBSyxDQUFDZ0MsS0FBVixDQUFnQmhDLEtBQUssQ0FBQ2dDLEtBQU4sQ0FBWW9ELG1CQUE1QixFQUFpRFgsS0FBakQsQ0FBTjtBQUNEO0FBQ0Y7O0FBRURjLE1BQU0sQ0FBQ0MsT0FBUCxHQUFpQjtBQUNmYixFQUFBQSxNQURlO0FBRWY1QyxFQUFBQSxHQUZlO0FBR2ZkLEVBQUFBLElBSGU7QUFJZlksRUFBQUEsR0FKZTtBQUtmaUQsRUFBQUE7QUFMZSxDQUFqQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIFRoaXMgZmlsZSBjb250YWlucyBoZWxwZXJzIGZvciBydW5uaW5nIG9wZXJhdGlvbnMgaW4gUkVTVCBmb3JtYXQuXG4vLyBUaGUgZ29hbCBpcyB0aGF0IGhhbmRsZXJzIHRoYXQgZXhwbGljaXRseSBoYW5kbGUgYW4gZXhwcmVzcyByb3V0ZVxuLy8gc2hvdWxkIGp1c3QgYmUgc2hhbGxvdyB3cmFwcGVycyBhcm91bmQgdGhpbmdzIGluIHRoaXMgZmlsZSwgYnV0XG4vLyB0aGVzZSBmdW5jdGlvbnMgc2hvdWxkIG5vdCBleHBsaWNpdGx5IGRlcGVuZCBvbiB0aGUgcmVxdWVzdFxuLy8gb2JqZWN0LlxuLy8gVGhpcyBtZWFucyB0aGF0IG9uZSBvZiB0aGVzZSBoYW5kbGVycyBjYW4gc3VwcG9ydCBtdWx0aXBsZVxuLy8gcm91dGVzLiBUaGF0J3MgdXNlZnVsIGZvciB0aGUgcm91dGVzIHRoYXQgZG8gcmVhbGx5IHNpbWlsYXJcbi8vIHRoaW5ncy5cblxudmFyIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlO1xuXG52YXIgUmVzdFF1ZXJ5ID0gcmVxdWlyZSgnLi9SZXN0UXVlcnknKTtcbnZhciBSZXN0V3JpdGUgPSByZXF1aXJlKCcuL1Jlc3RXcml0ZScpO1xudmFyIHRyaWdnZXJzID0gcmVxdWlyZSgnLi90cmlnZ2VycycpO1xuXG5mdW5jdGlvbiBjaGVja1RyaWdnZXJzKGNsYXNzTmFtZSwgY29uZmlnLCB0eXBlcykge1xuICByZXR1cm4gdHlwZXMuc29tZSh0cmlnZ2VyVHlwZSA9PiB7XG4gICAgcmV0dXJuIHRyaWdnZXJzLmdldFRyaWdnZXIoXG4gICAgICBjbGFzc05hbWUsXG4gICAgICB0cmlnZ2Vycy5UeXBlc1t0cmlnZ2VyVHlwZV0sXG4gICAgICBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjaGVja0xpdmVRdWVyeShjbGFzc05hbWUsIGNvbmZpZykge1xuICByZXR1cm4gKFxuICAgIGNvbmZpZy5saXZlUXVlcnlDb250cm9sbGVyICYmXG4gICAgY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIuaGFzTGl2ZVF1ZXJ5KGNsYXNzTmFtZSlcbiAgKTtcbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGFuIG9iamVjdCB3aXRoIG9wdGlvbmFsIGtleXMgJ3Jlc3VsdHMnIGFuZCAnY291bnQnLlxuZnVuY3Rpb24gZmluZChjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcmVzdFdoZXJlLCByZXN0T3B0aW9ucywgY2xpZW50U0RLKSB7XG4gIGVuZm9yY2VSb2xlU2VjdXJpdHkoJ2ZpbmQnLCBjbGFzc05hbWUsIGF1dGgpO1xuICByZXR1cm4gdHJpZ2dlcnNcbiAgICAubWF5YmVSdW5RdWVyeVRyaWdnZXIoXG4gICAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVGaW5kLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgcmVzdFdoZXJlLFxuICAgICAgcmVzdE9wdGlvbnMsXG4gICAgICBjb25maWcsXG4gICAgICBhdXRoXG4gICAgKVxuICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICByZXN0V2hlcmUgPSByZXN1bHQucmVzdFdoZXJlIHx8IHJlc3RXaGVyZTtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdWx0LnJlc3RPcHRpb25zIHx8IHJlc3RPcHRpb25zO1xuICAgICAgY29uc3QgcXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgICAgICBjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgcmVzdFdoZXJlLFxuICAgICAgICByZXN0T3B0aW9ucyxcbiAgICAgICAgY2xpZW50U0RLXG4gICAgICApO1xuICAgICAgcmV0dXJuIHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgICB9KTtcbn1cblxuLy8gZ2V0IGlzIGp1c3QgbGlrZSBmaW5kIGJ1dCBvbmx5IHF1ZXJpZXMgYW4gb2JqZWN0SWQuXG5jb25zdCBnZXQgPSAoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIG9iamVjdElkLCByZXN0T3B0aW9ucywgY2xpZW50U0RLKSA9PiB7XG4gIHZhciByZXN0V2hlcmUgPSB7IG9iamVjdElkIH07XG4gIGVuZm9yY2VSb2xlU2VjdXJpdHkoJ2dldCcsIGNsYXNzTmFtZSwgYXV0aCk7XG4gIHJldHVybiB0cmlnZ2Vyc1xuICAgIC5tYXliZVJ1blF1ZXJ5VHJpZ2dlcihcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZUZpbmQsXG4gICAgICBjbGFzc05hbWUsXG4gICAgICByZXN0V2hlcmUsXG4gICAgICByZXN0T3B0aW9ucyxcbiAgICAgIGNvbmZpZyxcbiAgICAgIGF1dGgsXG4gICAgICB0cnVlXG4gICAgKVxuICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICByZXN0V2hlcmUgPSByZXN1bHQucmVzdFdoZXJlIHx8IHJlc3RXaGVyZTtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdWx0LnJlc3RPcHRpb25zIHx8IHJlc3RPcHRpb25zO1xuICAgICAgY29uc3QgcXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgICAgICBjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgcmVzdFdoZXJlLFxuICAgICAgICByZXN0T3B0aW9ucyxcbiAgICAgICAgY2xpZW50U0RLXG4gICAgICApO1xuICAgICAgcmV0dXJuIHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgICB9KTtcbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgZG9lc24ndCByZXNvbHZlIHRvIGFueSB1c2VmdWwgdmFsdWUuXG5mdW5jdGlvbiBkZWwoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIG9iamVjdElkKSB7XG4gIGlmICh0eXBlb2Ygb2JqZWN0SWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCBvYmplY3RJZCcpO1xuICB9XG5cbiAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiBhdXRoLmlzVW5hdXRoZW50aWNhdGVkKCkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5TRVNTSU9OX01JU1NJTkcsXG4gICAgICAnSW5zdWZmaWNpZW50IGF1dGggdG8gZGVsZXRlIHVzZXInXG4gICAgKTtcbiAgfVxuXG4gIGVuZm9yY2VSb2xlU2VjdXJpdHkoJ2RlbGV0ZScsIGNsYXNzTmFtZSwgYXV0aCk7XG5cbiAgbGV0IGluZmxhdGVkT2JqZWN0O1xuICBsZXQgc2NoZW1hQ29udHJvbGxlcjtcblxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBoYXNUcmlnZ2VycyA9IGNoZWNrVHJpZ2dlcnMoY2xhc3NOYW1lLCBjb25maWcsIFtcbiAgICAgICAgJ2JlZm9yZURlbGV0ZScsXG4gICAgICAgICdhZnRlckRlbGV0ZScsXG4gICAgICBdKTtcbiAgICAgIGNvbnN0IGhhc0xpdmVRdWVyeSA9IGNoZWNrTGl2ZVF1ZXJ5KGNsYXNzTmFtZSwgY29uZmlnKTtcbiAgICAgIGlmIChoYXNUcmlnZ2VycyB8fCBoYXNMaXZlUXVlcnkgfHwgY2xhc3NOYW1lID09ICdfU2Vzc2lvbicpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXN0UXVlcnkoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIHsgb2JqZWN0SWQgfSlcbiAgICAgICAgICAuZXhlY3V0ZSh7IG9wOiAnZGVsZXRlJyB9KVxuICAgICAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHRzICYmIHJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZpcnN0UmVzdWx0ID0gcmVzcG9uc2UucmVzdWx0c1swXTtcbiAgICAgICAgICAgICAgZmlyc3RSZXN1bHQuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICAgICAgICAgICAgICBpZiAoY2xhc3NOYW1lID09PSAnX1Nlc3Npb24nICYmICFhdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFhdXRoLnVzZXIgfHwgZmlyc3RSZXN1bHQudXNlci5vYmplY3RJZCAhPT0gYXV0aC51c2VyLmlkKSB7XG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgICAgICAgICAgICAgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbidcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHZhciBjYWNoZUFkYXB0ZXIgPSBjb25maWcuY2FjaGVDb250cm9sbGVyO1xuICAgICAgICAgICAgICBjYWNoZUFkYXB0ZXIudXNlci5kZWwoZmlyc3RSZXN1bHQuc2Vzc2lvblRva2VuKTtcbiAgICAgICAgICAgICAgaW5mbGF0ZWRPYmplY3QgPSBQYXJzZS5PYmplY3QuZnJvbUpTT04oZmlyc3RSZXN1bHQpO1xuICAgICAgICAgICAgICByZXR1cm4gdHJpZ2dlcnMubWF5YmVSdW5UcmlnZ2VyKFxuICAgICAgICAgICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZURlbGV0ZSxcbiAgICAgICAgICAgICAgICBhdXRoLFxuICAgICAgICAgICAgICAgIGluZmxhdGVkT2JqZWN0LFxuICAgICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgICAgY29uZmlnXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kIGZvciBkZWxldGUuJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKCFhdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgIHJldHVybiBhdXRoLmdldFVzZXJSb2xlcygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4gY29uZmlnLmRhdGFiYXNlLmxvYWRTY2hlbWEoKSlcbiAgICAudGhlbihzID0+IHtcbiAgICAgIHNjaGVtYUNvbnRyb2xsZXIgPSBzO1xuICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgaWYgKCFhdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgIG9wdGlvbnMuYWNsID0gWycqJ107XG4gICAgICAgIGlmIChhdXRoLnVzZXIpIHtcbiAgICAgICAgICBvcHRpb25zLmFjbC5wdXNoKGF1dGgudXNlci5pZCk7XG4gICAgICAgICAgb3B0aW9ucy5hY2wgPSBvcHRpb25zLmFjbC5jb25jYXQoYXV0aC51c2VyUm9sZXMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb25maWcuZGF0YWJhc2UuZGVzdHJveShcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICB7XG4gICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdElkLFxuICAgICAgICB9LFxuICAgICAgICBvcHRpb25zLFxuICAgICAgICBzY2hlbWFDb250cm9sbGVyXG4gICAgICApO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gTm90aWZ5IExpdmVRdWVyeSBzZXJ2ZXIgaWYgcG9zc2libGVcbiAgICAgIGNvbnN0IHBlcm1zID0gc2NoZW1hQ29udHJvbGxlci5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lKTtcbiAgICAgIGNvbmZpZy5saXZlUXVlcnlDb250cm9sbGVyLm9uQWZ0ZXJEZWxldGUoXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgaW5mbGF0ZWRPYmplY3QsXG4gICAgICAgIG51bGwsXG4gICAgICAgIHBlcm1zXG4gICAgICApO1xuICAgICAgcmV0dXJuIHRyaWdnZXJzLm1heWJlUnVuVHJpZ2dlcihcbiAgICAgICAgdHJpZ2dlcnMuVHlwZXMuYWZ0ZXJEZWxldGUsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGluZmxhdGVkT2JqZWN0LFxuICAgICAgICBudWxsLFxuICAgICAgICBjb25maWdcbiAgICAgICk7XG4gICAgfSlcbiAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgaGFuZGxlU2Vzc2lvbk1pc3NpbmdFcnJvcihlcnJvciwgY2xhc3NOYW1lLCBhdXRoKTtcbiAgICB9KTtcbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEge3Jlc3BvbnNlLCBzdGF0dXMsIGxvY2F0aW9ufSBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGUoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIHJlc3RPYmplY3QsIGNsaWVudFNESykge1xuICBlbmZvcmNlUm9sZVNlY3VyaXR5KCdjcmVhdGUnLCBjbGFzc05hbWUsIGF1dGgpO1xuICB2YXIgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKFxuICAgIGNvbmZpZyxcbiAgICBhdXRoLFxuICAgIGNsYXNzTmFtZSxcbiAgICBudWxsLFxuICAgIHJlc3RPYmplY3QsXG4gICAgbnVsbCxcbiAgICBjbGllbnRTREtcbiAgKTtcbiAgcmV0dXJuIHdyaXRlLmV4ZWN1dGUoKTtcbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCBjb250YWlucyB0aGUgZmllbGRzIG9mIHRoZSB1cGRhdGUgdGhhdCB0aGVcbi8vIFJFU1QgQVBJIGlzIHN1cHBvc2VkIHRvIHJldHVybi5cbi8vIFVzdWFsbHksIHRoaXMgaXMganVzdCB1cGRhdGVkQXQuXG5mdW5jdGlvbiB1cGRhdGUoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIHJlc3RXaGVyZSwgcmVzdE9iamVjdCwgY2xpZW50U0RLKSB7XG4gIGVuZm9yY2VSb2xlU2VjdXJpdHkoJ3VwZGF0ZScsIGNsYXNzTmFtZSwgYXV0aCk7XG5cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgaGFzVHJpZ2dlcnMgPSBjaGVja1RyaWdnZXJzKGNsYXNzTmFtZSwgY29uZmlnLCBbXG4gICAgICAgICdiZWZvcmVTYXZlJyxcbiAgICAgICAgJ2FmdGVyU2F2ZScsXG4gICAgICBdKTtcbiAgICAgIGNvbnN0IGhhc0xpdmVRdWVyeSA9IGNoZWNrTGl2ZVF1ZXJ5KGNsYXNzTmFtZSwgY29uZmlnKTtcbiAgICAgIGlmIChoYXNUcmlnZ2VycyB8fCBoYXNMaXZlUXVlcnkpIHtcbiAgICAgICAgLy8gRG8gbm90IHVzZSBmaW5kLCBhcyBpdCBydW5zIHRoZSBiZWZvcmUgZmluZHNcbiAgICAgICAgcmV0dXJuIG5ldyBSZXN0UXVlcnkoXG4gICAgICAgICAgY29uZmlnLFxuICAgICAgICAgIGF1dGgsXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIHJlc3RXaGVyZSxcbiAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgIGZhbHNlXG4gICAgICAgICkuZXhlY3V0ZSh7XG4gICAgICAgICAgb3A6ICd1cGRhdGUnLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICAgIH0pXG4gICAgLnRoZW4oKHsgcmVzdWx0cyB9KSA9PiB7XG4gICAgICB2YXIgb3JpZ2luYWxSZXN0T2JqZWN0O1xuICAgICAgaWYgKHJlc3VsdHMgJiYgcmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgICAgb3JpZ2luYWxSZXN0T2JqZWN0ID0gcmVzdWx0c1swXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgUmVzdFdyaXRlKFxuICAgICAgICBjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgcmVzdFdoZXJlLFxuICAgICAgICByZXN0T2JqZWN0LFxuICAgICAgICBvcmlnaW5hbFJlc3RPYmplY3QsXG4gICAgICAgIGNsaWVudFNESyxcbiAgICAgICAgJ3VwZGF0ZSdcbiAgICAgICkuZXhlY3V0ZSgpO1xuICAgIH0pXG4gICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIGhhbmRsZVNlc3Npb25NaXNzaW5nRXJyb3IoZXJyb3IsIGNsYXNzTmFtZSwgYXV0aCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGhhbmRsZVNlc3Npb25NaXNzaW5nRXJyb3IoZXJyb3IsIGNsYXNzTmFtZSwgYXV0aCkge1xuICAvLyBJZiB3ZSdyZSB0cnlpbmcgdG8gdXBkYXRlIGEgdXNlciB3aXRob3V0IC8gd2l0aCBiYWQgc2Vzc2lvbiB0b2tlblxuICBpZiAoXG4gICAgY2xhc3NOYW1lID09PSAnX1VzZXInICYmXG4gICAgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCAmJlxuICAgICFhdXRoLmlzTWFzdGVyXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TRVNTSU9OX01JU1NJTkcsICdJbnN1ZmZpY2llbnQgYXV0aC4nKTtcbiAgfVxuICB0aHJvdyBlcnJvcjtcbn1cblxuY29uc3QgY2xhc3Nlc1dpdGhNYXN0ZXJPbmx5QWNjZXNzID0gW1xuICAnX0pvYlN0YXR1cycsXG4gICdfUHVzaFN0YXR1cycsXG4gICdfSG9va3MnLFxuICAnX0dsb2JhbENvbmZpZycsXG4gICdfSm9iU2NoZWR1bGUnLFxuXTtcbi8vIERpc2FsbG93aW5nIGFjY2VzcyB0byB0aGUgX1JvbGUgY29sbGVjdGlvbiBleGNlcHQgYnkgbWFzdGVyIGtleVxuZnVuY3Rpb24gZW5mb3JjZVJvbGVTZWN1cml0eShtZXRob2QsIGNsYXNzTmFtZSwgYXV0aCkge1xuICBpZiAoY2xhc3NOYW1lID09PSAnX0luc3RhbGxhdGlvbicgJiYgIWF1dGguaXNNYXN0ZXIpIHtcbiAgICBpZiAobWV0aG9kID09PSAnZGVsZXRlJyB8fCBtZXRob2QgPT09ICdmaW5kJykge1xuICAgICAgY29uc3QgZXJyb3IgPSBgQ2xpZW50cyBhcmVuJ3QgYWxsb3dlZCB0byBwZXJmb3JtIHRoZSAke21ldGhvZH0gb3BlcmF0aW9uIG9uIHRoZSBpbnN0YWxsYXRpb24gY29sbGVjdGlvbi5gO1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvL2FsbCB2b2xhdGlsZUNsYXNzZXMgYXJlIG1hc3RlcktleSBvbmx5XG4gIGlmIChjbGFzc2VzV2l0aE1hc3Rlck9ubHlBY2Nlc3MuaW5kZXhPZihjbGFzc05hbWUpID49IDAgJiYgIWF1dGguaXNNYXN0ZXIpIHtcbiAgICBjb25zdCBlcnJvciA9IGBDbGllbnRzIGFyZW4ndCBhbGxvd2VkIHRvIHBlcmZvcm0gdGhlICR7bWV0aG9kfSBvcGVyYXRpb24gb24gdGhlICR7Y2xhc3NOYW1lfSBjb2xsZWN0aW9uLmA7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sIGVycm9yKTtcbiAgfVxuXG4gIC8vIHJlYWRPbmx5IG1hc3RlcktleSBpcyBub3QgYWxsb3dlZFxuICBpZiAoXG4gICAgYXV0aC5pc1JlYWRPbmx5ICYmXG4gICAgKG1ldGhvZCA9PT0gJ2RlbGV0ZScgfHwgbWV0aG9kID09PSAnY3JlYXRlJyB8fCBtZXRob2QgPT09ICd1cGRhdGUnKVxuICApIHtcbiAgICBjb25zdCBlcnJvciA9IGByZWFkLW9ubHkgbWFzdGVyS2V5IGlzbid0IGFsbG93ZWQgdG8gcGVyZm9ybSB0aGUgJHttZXRob2R9IG9wZXJhdGlvbi5gO1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCBlcnJvcik7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGNyZWF0ZSxcbiAgZGVsLFxuICBmaW5kLFxuICBnZXQsXG4gIHVwZGF0ZSxcbn07XG4iXX0=