const AWS = require("aws-sdk")
const _ = require('lodash');
const s3 = new AWS.S3()
const pThrottle = require('p-throttle');
const throttledSync = pThrottle(syncObjects, 1000, 1000);
const throttledDelete = pThrottle(deleteObjects, 1000, 1000);
const Confirm = require('prompt-confirm');

function syncObjects(from, to, params) {
  var params = {} || params
  return s3.copyObject(Object.assign(params, {
    Bucket: to.bucket, 
    CopySource: encodeURI(`${from.bucket}/${from.key}`), 
    Key: to.key
  })).promise()
}

function deleteObjects(target, params) {
    var params = {} || params
    return s3.deleteObject(Object.assign(params, {
        Bucket: target.bucket, 
        Key: target.key
    })).promise()
}

function fetchList(bucket, prefix, ContinuationToken) {
  var params = {
    Bucket: bucket,
    MaxKeys: 1000,
    Prefix: prefix,
    ContinuationToken
  };
  return s3.listObjectsV2(params).promise();
}

async function listAll(bucket, prefix) {
  var allFiles = []
  var fetchedList = {};
  do {
    fetchedList = await fetchList(bucket, prefix, fetchedList.NextContinuationToken);
    allFiles = allFiles.concat(fetchedList.Contents);
  } while (fetchedList.NextContinuationToken);

  return allFiles.map((c) => {
    c.Key = c.Key.replace(prefix, "")
    return c
  })
}

async function sync(fromBucket, fromFolder, toBucket, toFolder, deleteNoneExist) {

  var fromList = await listAll(fromBucket, fromFolder)
  var toList = await listAll(toBucket, toFolder)

  const addList = _.differenceBy(fromList, toList, 'ETag');

  let rmList;
  if(deleteNoneExist){
    rmList = _.differenceBy(toList, fromList, 'ETag');
    if(rmList.length>0){
        const prompt = new Confirm(`Do you confirm to delete ${rmList.length} files those are no longer in ${fromBucket}/${fromFolder}?`);
        const answer = await prompt.run();
        if (!answer) {
            process.exit();
        }
    }
  }
  var allSyncPromises = [];
  var countAdd = 0;
  var bytesAdd = 0;
  addList.forEach((file) => {
    countAdd++;
    bytesAdd += file.Size;
    allSyncPromises.push(
      throttledSync({ bucket: fromBucket, key: fromFolder + file.Key }, { bucket: toBucket, key: toFolder + file.Key })
    )
  });
  var countRm = 0;
  var bytesRm = 0;
  if(deleteNoneExist){
    rmList.forEach((file) => {
        countRm++;
        bytesRm += file.Size;
        allSyncPromises.push(
            throttledDelete({ bucket: toBucket, key: toFolder + file.Key })
        )
    });
  }

  await Promise.all(allSyncPromises)
  return { countAdd, bytesAdd,countRm,bytesRm }
}

module.exports = {
  sync
}

if (require.main == module) {
  (async () => {
    var originBucket = 's3Bucket'
    var fromFolder = 'destination-folder/'
    var destinationFolder = 's3Bucket' // (can be the same one)
    var toFolder = 'origin-folder/'

    await sync(originBucket, fromFolder, destinationFolder, toFolder)
    // { count: 53, bytes: 2449367 } 
  })()
}