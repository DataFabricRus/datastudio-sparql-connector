function reformatByDatatype(value, xsdDatatype) {
  if(xsdDatatype) {
    if(xsdDatatype == "http://www.w3.org/2001/XMLSchema#date") {
      return value.replace(/Z|-/gi, "");
    }
    if(xsdDatatype == "http://www.w3.org/2001/XMLSchema#dateTime") {
      var match = value.match(/^\d{4}-\d{2}-\d{2}T\d{2}/g);
      if(match) {
        return match[0].replace(/T|-/gi, "");
      }
    }
    if(xsdDatatype == "http://www.w3.org/2001/XMLSchema#duration") {
      return durationToSecs(value);
    }
  }
  
  return value;
};

function getDefaultValue(schema) {
  if(schema.dataType == "NUMBER") {
    return 0;
  } else if(schema.dataType == "BOOLEAN") {
    return false;
  } else {
    return "";
  }
}

function durationToSecs(value) {
  var match = value.match(/PT(\d{1,2}H)*(\d{1,2}M)*([\d{1,2}\.]+S)*/i);
  if(match) {
    var seconds = 0;
    
    for(var i = 1; i < match.length; i++) {
      var d = match[i] || "";
      
      Logger.log(d);
      
      if(d[d.length - 1] == 'H') {
        seconds += parseInt(d.substring(0, d.length - 1)) * 60 * 60;
      } else if(d[d.length - 1] == 'M') {
        seconds += parseInt(d.substring(0, d.length - 1)) * 60;
      } else if(d[d.length - 1] == 'S') {
        seconds += parseInt(d.substring(0, d.length - 1));
      }
    }
    
    Logger.log(seconds);
    
    return seconds;
  }
  
  return 0;
};
