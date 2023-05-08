/** This describes the HTTP request method of a network request.  */
export enum RequestMethod {
  CONNECT = 'connect',
  DELETE = 'delete',
  GET = 'get',
  HEAD = 'head',
  OPTIONS = 'options',
  PATCH = 'patch',
  POST = 'post',
  PUT = 'put',
}

/** This describes the resource type of the network request. */
export enum ResourceType {
  MAIN_FRAME = 'main_frame',
  SUB_FRAME = 'sub_frame',
  STYLESHEET = 'stylesheet',
  SCRIPT = 'script',
  IMAGE = 'image',
  FONT = 'font',
  OBJECT = 'object',
  XMLHTTPREQUEST = 'xmlhttprequest',
  PING = 'ping',
  CSP_REPORT = 'csp_report',
  MEDIA = 'media',
  WEBSOCKET = 'websocket',
  OTHER = 'other',
}

/** Describes the kind of action to take if a given RuleCondition matches. */
export enum RuleActionType {
  BLOCK = 'block',
  REDIRECT = 'redirect',
  ALLOW = 'allow',
  UPGRADE_SCHEME = 'upgradeScheme',
  MODIFY_HEADERS = 'modifyHeaders',
  ALLOW_ALL_REQUESTS = 'allowAllRequests',
}

/** Describes the reason why a given regular expression isn't supported. */
export enum UnsupportedRegexReason {
  SYNTAX_ERROR = 'syntaxError',
  MEMORY_LIMIT_EXCEEDED = 'memoryLimitExceeded',
}

/** TThis describes whether the request is first or third party to the frame in which it originated.
 * A request is said to be first party if it has the same domain (eTLD+1) as the frame in which the request originated.
 */
export enum DomainType {
  FIRST_PARTY = 'firstParty',
  THIRD_PARTY = 'thirdParty',
}

/** This describes the possible operations for a "modifyHeaders" rule. */
export enum HeaderOperation {
  APPEND = 'append',
  SET = 'set',
  REMOVE = 'remove',
}
