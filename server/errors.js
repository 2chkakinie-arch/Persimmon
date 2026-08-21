'use strict';
/** Upstream/content error with HTTP status + code — llytpr-wl.v01nh. */
class YTError extends Error {
  constructor(message, status = 502, code = 'UPSTREAM') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { YTError };
