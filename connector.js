var startDateRegex = /\{dateRange\.startDate\}/gi;
var endDateRegex = /\{dateRange\.endDate\}/gi;
var numDaysRegex = /\{dateRange\.numDays\}/gi;

var ONE_DAY = 24 * 60 * 60 * 1000; //milliseconds

var cachedSchemaFields = null;

function getAuthType() {
  return {type: 'NONE'};
}

function getConfig() {
  console.info("getConfig");
    return {
        configParams: [
          {
            type: 'TEXTINPUT',
            name: 'endpoint',
            displayName: 'Enter the SPARQL Endpoint URL'
          },
          {
            type: 'TEXTAREA',
            name: 'query',
            displayName: 'Enter a SPARQL SELECT query'
          },
          {
            type: 'INFO',
            name: 'query-instructions',
            text: "Only SPARQL SELECT queries with projections are supported (query with * isn\'t supported). " + 
                  "Add a filter by date with placeholders for start and end dates, e.g. " + 
                  "FILTER(?startTime > \"{dateRange.startDate}\"^^xsd:dateTime && ?endTime < \"{dateRange.endDate}\"^^xsd:dateTime)"
          },
          {
            type: 'TEXTAREA',
            name: 'schema',
            displayName: 'Enter the schema of query results'
          },
          {
            type: 'INFO',
            name: 'schema-instructions',
            text: "The schema defines data types, etc. of the projected variables. An example:\n" +
            "[{ \"name\":\"location\", \"dataType\":\"STRING\" }, { \"name\":\"price\", \"dataType\":\"NUMBER\" }]. More about schemas: https://developers.google.com/datastudio/connector/semantics"
          }
        ],
        dateRangeRequired: true
    };
}

function isAdminUser() {
  return true;
}

function getSchema(request) {
  console.info('[getSchema] request: %s', request);
  
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

function execute(endpoint, query, options) {
  var formData = {
    'query': prepareQuery(query, options)
  };
  var requestOptions = {
    'method': 'post',
    'headers': { Accept: 'application/sparql-results+json' },
    'contentType': 'application/x-www-form-urlencoded',
    'payload': formData
  };
  var response = UrlFetchApp.fetch(endpoint, requestOptions);
  console.info("[execute] response: %s", response);
  
  var body = JSON.parse(response);
  console.info("[execute] body: %s", body);
  
  if(isQueryResultEmpty(body)) {
    return { values: [] };
  } else {
    return body.results.bindings.map(function(row) {
      var values = new Array();
      
      options.fields.forEach(function(rf) {
        var cell = row[rf.name];
        
        cell.value = reformatByDatatypes(cell.value, cell.datatype);
        
        values.push(cell.value);
      });
      
      return { values: values };
    });
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
    return qr.head.vars.some(function(variable){
      return !qr.results.bindings[variable];
    });
  }
  
  return false;
}