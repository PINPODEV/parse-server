"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _cryptoUtils = require("../cryptoUtils");

var _defaults = _interopRequireDefault(require("../defaults"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const MAIN_SCHEMA = '__MAIN_SCHEMA';
const SCHEMA_CACHE_PREFIX = '__SCHEMA';

class SchemaCache {
  constructor(cacheController, ttl = _defaults.default.schemaCacheTTL, singleCache = false) {
    this.ttl = ttl;

    if (typeof ttl == 'string') {
      this.ttl = parseInt(ttl);
    }

    this.cache = cacheController;
    this.prefix = SCHEMA_CACHE_PREFIX;

    if (!singleCache) {
      this.prefix += (0, _cryptoUtils.randomString)(20);
    }
  }

  getAllClasses() {
    if (!this.ttl) {
      return Promise.resolve(null);
    }

    return this.cache.get(this.prefix + MAIN_SCHEMA);
  }

  setAllClasses(schema) {
    if (!this.ttl) {
      return Promise.resolve(null);
    }

    return this.cache.put(this.prefix + MAIN_SCHEMA, schema);
  }

  getOneSchema(className) {
    if (!this.ttl) {
      return Promise.resolve(null);
    }

    return this.cache.get(this.prefix + MAIN_SCHEMA).then(cachedSchemas => {
      cachedSchemas = cachedSchemas || [];
      const schema = cachedSchemas.find(cachedSchema => {
        return cachedSchema.className === className;
      });

      if (schema) {
        return Promise.resolve(schema);
      }

      return Promise.resolve(null);
    });
  }

  clear() {
    return this.cache.del(this.prefix + MAIN_SCHEMA);
  }

}

exports.default = SchemaCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDYWNoZS5qcyJdLCJuYW1lcyI6WyJNQUlOX1NDSEVNQSIsIlNDSEVNQV9DQUNIRV9QUkVGSVgiLCJTY2hlbWFDYWNoZSIsImNvbnN0cnVjdG9yIiwiY2FjaGVDb250cm9sbGVyIiwidHRsIiwiZGVmYXVsdHMiLCJzY2hlbWFDYWNoZVRUTCIsInNpbmdsZUNhY2hlIiwicGFyc2VJbnQiLCJjYWNoZSIsInByZWZpeCIsImdldEFsbENsYXNzZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsImdldCIsInNldEFsbENsYXNzZXMiLCJzY2hlbWEiLCJwdXQiLCJnZXRPbmVTY2hlbWEiLCJjbGFzc05hbWUiLCJ0aGVuIiwiY2FjaGVkU2NoZW1hcyIsImZpbmQiLCJjYWNoZWRTY2hlbWEiLCJjbGVhciIsImRlbCJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUdBOztBQUNBOzs7O0FBSkEsTUFBTUEsV0FBVyxHQUFHLGVBQXBCO0FBQ0EsTUFBTUMsbUJBQW1CLEdBQUcsVUFBNUI7O0FBS2UsTUFBTUMsV0FBTixDQUFrQjtBQUcvQkMsRUFBQUEsV0FBVyxDQUNUQyxlQURTLEVBRVRDLEdBQUcsR0FBR0Msa0JBQVNDLGNBRk4sRUFHVEMsV0FBVyxHQUFHLEtBSEwsRUFJVDtBQUNBLFNBQUtILEdBQUwsR0FBV0EsR0FBWDs7QUFDQSxRQUFJLE9BQU9BLEdBQVAsSUFBYyxRQUFsQixFQUE0QjtBQUMxQixXQUFLQSxHQUFMLEdBQVdJLFFBQVEsQ0FBQ0osR0FBRCxDQUFuQjtBQUNEOztBQUNELFNBQUtLLEtBQUwsR0FBYU4sZUFBYjtBQUNBLFNBQUtPLE1BQUwsR0FBY1YsbUJBQWQ7O0FBQ0EsUUFBSSxDQUFDTyxXQUFMLEVBQWtCO0FBQ2hCLFdBQUtHLE1BQUwsSUFBZSwrQkFBYSxFQUFiLENBQWY7QUFDRDtBQUNGOztBQUVEQyxFQUFBQSxhQUFhLEdBQUc7QUFDZCxRQUFJLENBQUMsS0FBS1AsR0FBVixFQUFlO0FBQ2IsYUFBT1EsT0FBTyxDQUFDQyxPQUFSLENBQWdCLElBQWhCLENBQVA7QUFDRDs7QUFDRCxXQUFPLEtBQUtKLEtBQUwsQ0FBV0ssR0FBWCxDQUFlLEtBQUtKLE1BQUwsR0FBY1gsV0FBN0IsQ0FBUDtBQUNEOztBQUVEZ0IsRUFBQUEsYUFBYSxDQUFDQyxNQUFELEVBQVM7QUFDcEIsUUFBSSxDQUFDLEtBQUtaLEdBQVYsRUFBZTtBQUNiLGFBQU9RLE9BQU8sQ0FBQ0MsT0FBUixDQUFnQixJQUFoQixDQUFQO0FBQ0Q7O0FBQ0QsV0FBTyxLQUFLSixLQUFMLENBQVdRLEdBQVgsQ0FBZSxLQUFLUCxNQUFMLEdBQWNYLFdBQTdCLEVBQTBDaUIsTUFBMUMsQ0FBUDtBQUNEOztBQUVERSxFQUFBQSxZQUFZLENBQUNDLFNBQUQsRUFBWTtBQUN0QixRQUFJLENBQUMsS0FBS2YsR0FBVixFQUFlO0FBQ2IsYUFBT1EsT0FBTyxDQUFDQyxPQUFSLENBQWdCLElBQWhCLENBQVA7QUFDRDs7QUFDRCxXQUFPLEtBQUtKLEtBQUwsQ0FBV0ssR0FBWCxDQUFlLEtBQUtKLE1BQUwsR0FBY1gsV0FBN0IsRUFBMENxQixJQUExQyxDQUErQ0MsYUFBYSxJQUFJO0FBQ3JFQSxNQUFBQSxhQUFhLEdBQUdBLGFBQWEsSUFBSSxFQUFqQztBQUNBLFlBQU1MLE1BQU0sR0FBR0ssYUFBYSxDQUFDQyxJQUFkLENBQW1CQyxZQUFZLElBQUk7QUFDaEQsZUFBT0EsWUFBWSxDQUFDSixTQUFiLEtBQTJCQSxTQUFsQztBQUNELE9BRmMsQ0FBZjs7QUFHQSxVQUFJSCxNQUFKLEVBQVk7QUFDVixlQUFPSixPQUFPLENBQUNDLE9BQVIsQ0FBZ0JHLE1BQWhCLENBQVA7QUFDRDs7QUFDRCxhQUFPSixPQUFPLENBQUNDLE9BQVIsQ0FBZ0IsSUFBaEIsQ0FBUDtBQUNELEtBVE0sQ0FBUDtBQVVEOztBQUVEVyxFQUFBQSxLQUFLLEdBQUc7QUFDTixXQUFPLEtBQUtmLEtBQUwsQ0FBV2dCLEdBQVgsQ0FBZSxLQUFLZixNQUFMLEdBQWNYLFdBQTdCLENBQVA7QUFDRDs7QUFuRDhCIiwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgTUFJTl9TQ0hFTUEgPSAnX19NQUlOX1NDSEVNQSc7XG5jb25zdCBTQ0hFTUFfQ0FDSEVfUFJFRklYID0gJ19fU0NIRU1BJztcblxuaW1wb3J0IHsgcmFuZG9tU3RyaW5nIH0gZnJvbSAnLi4vY3J5cHRvVXRpbHMnO1xuaW1wb3J0IGRlZmF1bHRzIGZyb20gJy4uL2RlZmF1bHRzJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2NoZW1hQ2FjaGUge1xuICBjYWNoZTogT2JqZWN0O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGNhY2hlQ29udHJvbGxlcixcbiAgICB0dGwgPSBkZWZhdWx0cy5zY2hlbWFDYWNoZVRUTCxcbiAgICBzaW5nbGVDYWNoZSA9IGZhbHNlXG4gICkge1xuICAgIHRoaXMudHRsID0gdHRsO1xuICAgIGlmICh0eXBlb2YgdHRsID09ICdzdHJpbmcnKSB7XG4gICAgICB0aGlzLnR0bCA9IHBhcnNlSW50KHR0bCk7XG4gICAgfVxuICAgIHRoaXMuY2FjaGUgPSBjYWNoZUNvbnRyb2xsZXI7XG4gICAgdGhpcy5wcmVmaXggPSBTQ0hFTUFfQ0FDSEVfUFJFRklYO1xuICAgIGlmICghc2luZ2xlQ2FjaGUpIHtcbiAgICAgIHRoaXMucHJlZml4ICs9IHJhbmRvbVN0cmluZygyMCk7XG4gICAgfVxuICB9XG5cbiAgZ2V0QWxsQ2xhc3NlcygpIHtcbiAgICBpZiAoIXRoaXMudHRsKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYWNoZS5nZXQodGhpcy5wcmVmaXggKyBNQUlOX1NDSEVNQSk7XG4gIH1cblxuICBzZXRBbGxDbGFzc2VzKHNjaGVtYSkge1xuICAgIGlmICghdGhpcy50dGwpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNhY2hlLnB1dCh0aGlzLnByZWZpeCArIE1BSU5fU0NIRU1BLCBzY2hlbWEpO1xuICB9XG5cbiAgZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSkge1xuICAgIGlmICghdGhpcy50dGwpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNhY2hlLmdldCh0aGlzLnByZWZpeCArIE1BSU5fU0NIRU1BKS50aGVuKGNhY2hlZFNjaGVtYXMgPT4ge1xuICAgICAgY2FjaGVkU2NoZW1hcyA9IGNhY2hlZFNjaGVtYXMgfHwgW107XG4gICAgICBjb25zdCBzY2hlbWEgPSBjYWNoZWRTY2hlbWFzLmZpbmQoY2FjaGVkU2NoZW1hID0+IHtcbiAgICAgICAgcmV0dXJuIGNhY2hlZFNjaGVtYS5jbGFzc05hbWUgPT09IGNsYXNzTmFtZTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHNjaGVtYSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHNjaGVtYSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpO1xuICAgIH0pO1xuICB9XG5cbiAgY2xlYXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUuZGVsKHRoaXMucHJlZml4ICsgTUFJTl9TQ0hFTUEpO1xuICB9XG59XG4iXX0=