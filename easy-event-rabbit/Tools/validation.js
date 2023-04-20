/*Copyright 2019 Evsent

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/

var Ajv = require('ajv');
var ajv = new Ajv({ $data: true, allErrors: true, schemaId: 'auto' });
var GenerateSchema = require('generate-schema')
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'));
var instantiator = require('json-schema-instantiator');
require('./linkRequirments.js');
var schemaParser = require('./schemaParser.js')
var dbh = require("../modules/dbConnectionHandler")
const exception = require('../modules/eventSenderException');
const stringBuilder = require('./stringBuilder');


//validates Schema (data: an event to be validated, cb is callback function that is run with errors after validation finishes)
function validate(data,edition){
  return new Promise((resolve,reject)=>{

    schema = schemaParser.matchDatatoSchema(data,edition)
    var valid = ajv.validate(schema, data);

    if (!valid) {
      reject(new exception.eventSenderException(stringBuilder.buildStringAJV(ajv.errors), exception.errorType.INVALID_OBJECT_CREATED));
    }  else {
      resolve()
    }
  })
}

//same as validate but do not validate meta time, id, version and links as these will be added later
function initialValidate(data,edition){

  if(data.meta.version == ""){
    delete data.meta.version
  }

  return new Promise((resolve,reject)=>{

    schema = schemaParser.matchDatatoSimplifiedSchema(data,edition)
    var valid = ajv.validate(schema, data);
    if (!valid) reject(new exception.eiffelException(stringBuilder.buildStringAJV(ajv.errors), exception.errorType.INVALID_SCHEMA)); else resolve()

  })
}

function linkCheck(data,edition){
  return new Promise((resolve,reject) =>{
  lookUpArray = findAllRequiredLinks(data,edition)
  if(lookUpArray.length < 1 || lookUpArray == undefined){
    resolve()
  } else {
    //TODO: add lookUpArray in exception call
    reject(new exception.lookUpException("Links missing: " + lookUpArray.join(), exception.errorType.MISSING_LINKS))
  }

})
}

//check if all required links are present with use of linkRequirements.js
function findAllRequiredLinks(data,edition){
  linkArr = []
  missingArr = []
  reqs = requiredLinks(data,edition)
  for(i in data.links){
    linkArr.push(data.links[i].type)
  }
  for(i in reqs)
  if(!linkArr.includes(reqs[i])){
    missingArr.push(reqs[i]);
  }
  return missingArr
}

//Make list of required fields for the schema
function requiredLinks(data,edition){
  required = []
  reqSchema = schemaParser.matchDatatoSchema(data,edition)
  schemaName = schemaParser.getSchemaType(reqSchema)
  reqs = linkRequirments[schemaName]
  for(i in reqs){
    if(reqs[i].required){
      required.push(i)
    }
  }
  return required
}

function linkCheckDB(data, edition) {
  return new Promise((resolve, reject) => {
      if (data.links != null && data.links.length != 0) {

          let schema = schemaParser.matchDatatoSchema(data, edition)
          var version = schemaParser.getSchemaVersion(schema)
          let dataLinks = []

          data.links.forEach(element => {
              dataLinks.push(element.type)
          });

          var exName = data.meta.type

          dbh.getEventDBInstance((db, err) => {

              let promiseArray = [];

              for (let i in dataLinks) {
                  let targets = linkRequirments[exName][dataLinks[i]].legal_targets
                  if (targets == 'any') {
                      resolve()
                  } else {
                      let target = data.links[i].target

                      let targetPromises = targets.map(function (link) {
                          return new Promise((resolve, reject) => {
                              dbh.basicQuery(db, link, version, target, { "_id": 0, "meta.type": 1 }, dataLinks[i], function (data, matches, target, linkType) {
                                  if (matches == 0) {
                                      resolve(null);
                                  } else if (matches == 1) {
                                      if (targets.includes(data.meta.type)) {
                                          resolve(data.meta.type);
                                      } else {
                                          reject(new exception.eiffelException("The link corresponding to " + target + " is of type " + data.meta.type + ", it is not a legal target for this link", exception.errorType.ILLEGAL_LINK_TARGET));
                                      }
                                  } else {
                                      reject(new exception.eiffelException("More than one match in query for the UUID", exception.errorType.UUID_NOT_UNIQUE));
                                  }
                              });
                          });
                      });

                      promiseArray.push(...targetPromises);
                  }
              }

              Promise.allSettled(promiseArray)
                  .then(results => {
                      let legalmatch = [];
                      results.forEach(result => {
                          if (result.status === "fulfilled" && result.value !== null) {
                              legalmatch.push(result.value);
                          }
                      });

                      if (legalmatch.length === 0) {
                          reject(new exception.eiffelException("No legal target corresponding to " + target + " in database, link type " + linkType, exception.errorType.ILLEGAL_LINK_TARGET));
                      } else if (targets.includes(legalmatch[0])) {
                          resolve();
                      } else {
                          reject(new exception.eiffelException("Found more than one match for this link... Something wrong with DB?", exception.errorType.MULTIPLE_LINKS_FOUND));
                      }
                  })
                  .catch(error => {
                      reject(error);
                  });

          });
      } else {
          resolve();
      }
  });
}

module.exports = {
  validate,
  initialValidate,
  linkCheck,
  linkCheckDB
}

//linkCheck(examples[0])

//linkCheckDB(examples[1])
