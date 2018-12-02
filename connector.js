var startDateRegex = /\{dateRange\.startDate\}/gi;
var endDateRegex = /\{dateRange\.endDate\}/gi;
var numDaysRegex = /\{dateRange\.numDays\}/gi;

var ONE_DAY = 24 * 60 * 60 * 1000; //milliseconds

var cachedSchemaFields = null;

//
// Public API
//

function getAuthType() {
  return {type: 'NONE'};
}

function getConfig() {
  var cc = DataStudioApp.createCommunityConnector();
  var config = cc.getConfig();
  
  config.newTextInput()
  .setId('endpoint')
  .setName('Enter SPARQL Endpoint URL');
  
  config.newTextArea()
  .setId('query')
  .setName('Enter SPARQL SELECT query');
  
  config.newInfo()
  .setText("Only SPARQL SELECT queries with projections are supported (query with * isn\'t supported). " + 
           "Add a filter by date with placeholders for start and end dates, e.g. " + 
           "FILTER(?startTime > \"{dateRange.startDate}\"^^xsd:dateTime && ?endTime < \"{dateRange.endDate}\"^^xsd:dateTime)");
  
  config.newTextArea()
  .setId('schema')
  .setName('Enter the schema of query results');
  
  config.newInfo()
  .setText("The schema defines data types, etc. of the projected variables. An example:\n" +
           "[{ \"name\":\"location\", \"dataType\":\"STRING\" }, { \"name\":\"price\", \"dataType\":\"NUMBER\" }]. More about schemas: https://developers.google.com/datastudio/connector/semantics")
  
  config.setDateRangeRequired(true);
  
  return config.build();
}

function isAdminUser() {
  return true;
}

function getSchema(request) {
  console.info('[getSchema] request: %s', request);
  
  _checkEndpointURL(request.configParams.endpoint);
  
  var schema = JSON.parse(request.configParams.schema);

  return {schema: schema};
}

function getData(request) {
  console.info("[getData] request: %s", request);
  
  var schema = filteredSchema(JSON.parse(request.configParams.schema), request.fields);
  
  if(request.scriptParams && request.scriptParams.sampleExtraction) {
    console.log("[getData] sampleExtraction");
    return { schema: schema, rows: [] };
  } else {
    var rows = execute(request.configParams.endpoint, request.configParams.query, request);
  
    console.info("[getData] schema: %s", schema);
    console.info("[getData] rows: %s", rows);
  
    return { schema: schema, rows: rows };
  }
}

//
// Private API
//

/**
 * Checks if the given SPARQL endpoint is accessible and supports JSON as the result format.
 * @param {string}
 */
function _checkEndpointURL(url) {
  var body = null;
  try {
    var formData = { 'query': 'SELECT * {?x ?y ?z} LIMIT 1' };
    var requestOptions = {
      'method': 'post',
      'headers': { Accept: 'application/sparql-results+json' },
      'contentType': 'application/x-www-form-urlencoded',
      'payload': formData
    };
    var response = UrlFetchApp.fetch(url, requestOptions);
    
    body = JSON.parse(response);
  } catch(error) {
    logConnectorError(error, 'dysfunctional_endpoint');
    throwConnectorError("Failed to communicate with the endpoint. Please, check SPARQL endpoint url.", true);
  }
  
  if(!body.head || !body.results) {
    throwConnectorError("Failed to handle SPARQL endpoint result format. Please, check that SPARQL endpoint supports JSON as result format.", true);
  }
}

function execute(endpoint, query, options) {
  try {
    var formData = {
      'query': prepareQuery(query, options)
    };
  } catch(e) {
    logConnectorError(e, 'prepare_query');
    throwConnectorError("Failed to pre-process the query. Please, check your SPARQL query.", true);
  }
  
  try {
    var requestOptions = {
      'method': 'post',
      'headers': { Accept: 'application/sparql-results+json' },
      'contentType': 'application/x-www-form-urlencoded',
      'payload': formData
    };
    var response = UrlFetchApp.fetch(endpoint, requestOptions);
    console.info("[execute] response: %s", response);
  } catch(e) {
    logConnectorError(e, 'execute_query');
    throwConnectorError("Failed to execute the query. Please, check the endpoint URL and the query.", true);
  }
  
  try {
    var body = JSON.parse(response);
    console.info("[execute] body: %s", body);
  } catch(e) {
    logConnectorError(e, 'parse_json');
    throwConnectorError("Failed to parse the query results. Please, check that the SPARQL endpoint supports 'application/sparql-results+json'.", true);
  }
  
  try {
    if(isQueryResultEmpty(body)) {
      return { values: [] };
    } else {
      return body.results.bindings.map(function(row) {
        var values = new Array();
        
        options.fields.forEach(function(rf) {
          var cell = row[rf.name];
          
          if(cell) {
            values.push(reformatByDatatype(cell.value, cell.datatype));
          } else {
            values.push(getDefaultValue(cachedSchemaFields[rf.name]));
          }
        });
        
        return { values: values };
      });
    }
  } catch(e) {
    logConnectorError(e, 'postprocess_results');
  }
}

function filteredSchema(schema, requestedFields) {
  if(!cachedSchemaFields) {
    cachedSchemaFields = new Object();
    schema.forEach(function(field) {
      cachedSchemaFields[field.name] = field;
    });
  }
  
  return requestedFields.map(function(field) {
    return cachedSchemaFields[field.name];
  });
}

function prepareQuery(query, options) {
  var preparedQuery = query;
  if(options.dateRange && options.dateRange.startDate && options.dateRange.endDate) {
    var startDate = new Date(options.dateRange.startDate);
    var endDate = new Date(options.dateRange.endDate);
    if(endDate.getTime() > Date.now()) {
      var now = new Date();
      now.setDate(now.getDate() - 1);
      endDate = now;
    }
    var numDays = Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY) + 1;
    preparedQuery = preparedQuery
                    .replace(startDateRegex, options.dateRange.startDate)
                    .replace(endDateRegex, options.dateRange.endDate)
                    .replace(numDaysRegex, numDays);
  }
  if(options.pagination){
    if(options.pagination.rowCount) {
      preparedQuery += "\nLIMIT " + parseInt(options.pagination.rowCount);
    }
    if(options.pagination.startRow) {
      preparedQuery += "\nOFFSET " + (parseInt(options.pagination.startRow) - 1);
    }
  }
  
  console.info("[prepareQuery] query: %s", preparedQuery);
  
  return preparedQuery;
}

function isQueryResultEmpty(qr) {
  if(qr.results.bindings.length == 0) {
    return true;
  } else if(qr.results.bindings.length == 1) {
    return qr.head.vars.some(function(variable) {
      return !qr.results.bindings[0].hasOwnProperty(variable);
    });
  }
  
  return false;
}