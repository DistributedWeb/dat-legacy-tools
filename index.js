const path = require('path')
const crypto = require('crypto')
const dwebfs = require('dwebfs')
const datStorage = require('./dweb-storage')
const pda = require('dbrowser-dweb-api')
const dft = require('diff-file-tree')
const swarmDefaults = require('dbrowser-swarm-defaults')
const discoverySwarm = require('dweb-discovery-swarm')
const hypercoreProtocol = require('ddatabase-protocol')
const DAT_SWARM_PORT = 6620

// globals
// =

var BASE_PATH = undefined
var networkId = crypto.randomBytes(32)
var archiveSwarm
var archive

// exported api
// =

exports.setup = async function ({beakerDataDir}) {
  BASE_PATH = beakerDataDir
  await datStorage.setup()

  archiveSwarm = discoverySwarm(swarmDefaults({
    id: networkId,
    hash: false,
    utp: true,
    tcp: true,
    dht: false,
    stream: createReplicationStream
  }))
  archiveSwarm.once('error', () => archiveSwarm.listen(0))
  archiveSwarm.listen(DAT_SWARM_PORT)
}

exports.exportFiles = async function (key, targetPath) {
  await loadArchive(key)
  var diff = await dft.diff({fs: archive, name: '/'}, targetPath)
  await dft.applyRight({fs: archive, name: '/'}, targetPath, diff)
  return pda.readdir(archive, '/', {recursive: true})
}

// internal
// =

function getArchiveMetaPath (key) {
  return path.join(BASE_PATH, 'DWeb', 'Archives', 'Meta', key.slice(0, 2), key.slice(2))
}

async function loadArchive (key) {
  var metaPath = getArchiveMetaPath(key)
  archive = dwebfs(datStorage.create(metaPath), Buffer.from(key, 'hex'), {sparse: true})
  archive.on('error', err => {
    throw err
  })
  await new Promise((resolve, reject) => {
    archive.ready(err => {
      if (err) reject(err)
      else resolve()
    })
  })
  archiveSwarm.join(archive.discoveryKey)

  if (!archive.writable && !archive.metadata.length) {
    // wait to receive a first update
    await new Promise((resolve, reject) => {
      archive.metadata.update(err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  if (!archive.writable) {
    await pda.download(archive, '/')
  }
}

function createReplicationStream (info) {
  // create the protocol stream
  var stream = hypercoreProtocol({
    id: networkId,
    live: true,
    encrypt: true
  })
  stream.peerInfo = info

  // add the archive if the discovery network gave us any info
  if (info.channel) {
    add(info.channel)
  }

  // add any requested archives
  stream.on('feed', add)

  function add (dkey) {
    archive.replicate({stream, live: true})
  }

  return stream
}