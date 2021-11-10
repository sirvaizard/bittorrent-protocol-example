import crypto from 'crypto'
import fs from 'fs/promises'
import dgram, { Socket } from 'dgram'
import { Buffer } from 'buffer'
import { URL } from 'url'
import bencode from 'bencode'
import bignum from 'bignum'
import net from 'net'

const CONNECT = 0
const ANNOUNCE = 1
const SCRAPE = 2
const ERROR = 3

const torrentFilename = '007.torrent'
const torrentFile = await fs.readFile(torrentFilename)

const torrent = bencode.decode(torrentFile, 'utf8')
const torrentInfo = bencode.encode(torrent.info)
const infoHash = crypto.createHash('sha1').update(torrentInfo).digest()

const leftDownload = torrent.info.length ? torrent.info.length :
    torrent.info.files.reduce((acc, curr) => acc + curr.length, 0)

const leftDownloadBuffer = bignum.toBuffer(leftDownload, {size: 8})

const peerId = crypto.randomBytes(20)
Buffer.from('-AT0001-').copy(peerId, 0);

// for (const [key, value] of Object.entries(torrent)) {
//     console.log(`[${key}]: ${value}`)
// }

// for (const [key, value] of Object.entries(torrent.info)) {
//     console.log(`[${key}]: ${value}`)
// }

const UDPSocket = dgram.createSocket('udp4')

// https://www.bittorrent.org/beps/bep_0015.html
// A requisição via UDP requer um pacote de 16 bytes com esse formato:
// Offset  Size            Name            Value
// 0       64-bit integer  protocol_id     0x41727101980 // constante mágica
// 8       32-bit integer  action          0 // connect
// 12      32-bit integer  transaction_id
// 16
const transactionId = Math.floor((Math.random()*100000)+1);
const connectionRequest = Buffer.alloc(16, 0)
connectionRequest.writeUInt32BE(0x417, 0)
connectionRequest.writeUInt32BE(0x27101980, 4)
connectionRequest.writeUInt32BE(0, 8)
connectionRequest.writeUInt32BE(transactionId, 12)

UDPSocket.on('message', (msg, rinfo) => {
    // for (const [key, value] of Object.entries(rinfo)) {
    //     console.log(`[rinfo-${key}]: ${value}`)
    // }

    const response = Buffer.from(msg)
    const action = response.readUInt32BE(0)
    const transactionId = response.readUInt32BE(4)
    
    console.log(`Action: ${action}`)
    console.log(`TransactionId: ${transactionId}`)

    if (action === CONNECT) {
        // Formato da resposta
        // Offset  Size            Name            Value
        // 0       32-bit integer  action          0 // connect
        // 4       32-bit integer  transaction_id
        // 8       64-bit integer  connection_id
        // 16
        const connectionIdHigh = response.readUInt32BE(8)
        const connectionIdLow = response.readUInt32BE(12)

        console.log(`Connect`)
        scrape(connectionIdHigh, connectionIdLow, transactionId)
        announce(connectionIdHigh, connectionIdLow)
    } else if (action === ANNOUNCE) {
        // Formato resposta
        // Offset      Size            Name            Value
        // 0           32-bit integer  action          1 // announce
        // 4           32-bit integer  transaction_id
        // 8           32-bit integer  interval
        // 12          32-bit integer  leechers
        // 16          32-bit integer  seeders
        // 20 + 6 * n  32-bit integer  IP address
        // 24 + 6 * n  16-bit integer  TCP port
        // 20 + 6 * N
        console.log('Announce')
        const interval = response.readUInt32BE(8)
        const leechers = response.readUInt32BE(12)
        const seeders = response.readUInt32BE(16)
        const peers = []

        for (let i = 20; i < response.length; i += 6) {
            peers.push({
                host: [response.readUInt8(i), response.readUInt8(i+1),
                                   response.readUInt8(i+2), response.readUInt8(i+3)].join('.'),
                port: response.readUInt16BE(i+4)
            })
        }


        console.log(`interval: ${interval}`)
        console.log(`leechers: ${leechers}`)
        console.log(`seeders: ${seeders}`)
        console.log(peers)

        download(peers)
    } else if (action === SCRAPE) {
        // Formato da resposta
        // Offset      Size            Name            Value
        // 0           32-bit integer  action          2 // scrape
        // 4           32-bit integer  transaction_id
        // 8 + 12 * n  32-bit integer  seeders
        // 12 + 12 * n 32-bit integer  completed
        // 16 + 12 * n 32-bit integer  leechers
        // 8 + 12 * N
        console.log('Scrape')
        const seeders = response.readUInt32BE(8)
        const completed = response.readUInt32BE(12)
        const leechers = response.readUInt32BE(16)

        console.log(`seeders: ${seeders}`)
        console.log(`completed: ${completed}`)
        console.log(`leechers: ${leechers}`)
    } else if (action === ERROR) {
        console.log('Error')
    }
    console.log('\n')
})

// O announce padrão não estava me retornando resposta, então peguei
// o primeiro da announce-list que me retornou algo.
const announceURL = torrent['announce-list'][2][0]
console.log('announce:::', announceURL)
const url = new URL(announceURL)
UDPSocket.send(connectionRequest, 0, connectionRequest.length, url.port, url.hostname, (error, _) => {
    if (error) {
        console.log(`error: ${error}`)
    }
})

function scrape (connectionIdHigh, connectionIdLow, transactionId) {
    // Scrape request
    // Offset          Size            Name            Value
    // 0               64-bit integer  connection_id
    // 8               32-bit integer  action          2 // scrape
    // 12              32-bit integer  transaction_id
    // 16 + 20 * n     20-byte string  info_hash
    // 16 + 20 * N
    const scrapeRequest = Buffer.alloc(56, 0)
    scrapeRequest.writeUInt32BE(connectionIdHigh, 0)
    scrapeRequest.writeUInt32BE(connectionIdLow, 4)
    scrapeRequest.writeUInt32BE(SCRAPE, 8)
    scrapeRequest.writeUInt32BE(transactionId, 12)
    scrapeRequest.write(infoHash.toString(), 16, scrapeRequest.length, 'hex')

    UDPSocket.send(scrapeRequest, 0, scrapeRequest.length, url.port, url.hostname, (error, _) => {
        if (error)
            console.log(`error: ${error}`)
    })
}

function announce (connectionIdHigh, connectionIdLow) {
    // Offset  Size    Name    Value
    // 0       64-bit integer  connection_id
    // 8       32-bit integer  action          1 // announce
    // 12      32-bit integer  transaction_id
    // 16      20-byte string  info_hash
    // 36      20-byte string  peer_id
    // 56      64-bit integer  downloaded
    // 64      64-bit integer  left
    // 72      64-bit integer  uploaded
    // 80      32-bit integer  event           0 // 0: none; 1: completed; 2: started; 3: stopped
    // 84      32-bit integer  IP address      0 // default
    // 88      32-bit integer  key
    // 92      32-bit integer  num_want        -1 // default
    // 96      16-bit integer  port
    // 98
    const transactionId = Math.floor((Math.random()*100000)+1);
    const announceRequest = Buffer.alloc(98, 0)
    // connection_id
    announceRequest.writeUInt32BE(connectionIdHigh, 0)
    announceRequest.writeUInt32BE(connectionIdLow, 4)
    // action
    announceRequest.writeUInt32BE(ANNOUNCE, 8)
    // transaction_id
    announceRequest.writeUInt32BE(transactionId, 12)
    // info_hash
    announceRequest.write(infoHash.toString(), 16, 20, 'hex')
    // peer_id
    peerId.copy(announceRequest, 36)
    // left
    leftDownloadBuffer.copy(announceRequest, 64)
    // key
    crypto.randomBytes(4).copy(announceRequest, 88)
    // num_want
    announceRequest.writeInt32BE(-1, 92)
    // port
    announceRequest.writeUInt16BE(url.port, 96)

    UDPSocket.send(announceRequest, 0, announceRequest.length, url.port, url.hostname, (error, _) => {
        if (error)
            console.log(`error: ${error}`)
    })
}

function buildHandshake () {
    const handshake = Buffer.alloc(68, 0)
    // Length do nome do protocolo (19)
    handshake.writeUInt8(19, 0)
    // Nome do protocolo
    handshake.write('BitTorrent protocol')
    // info_hash
    infoHash.copy(handshake, 28)
    // peer_id
    peerId.copy(handshake, 48)

    return handshake
}



function download (peers) {
    console.log('download')
    
    const handshake = buildHandshake()
    console.log('handshake:::', handshake.toString())
    
    for (const peer of peers) {
        const TCPSocket = new net.Socket()
        TCPSocket.on('error', (error) => {
            console.warn('error::', peer.host)
        })
    
        TCPSocket.on('data', (data) => {
            console.log('data::', data)
        })
    
    
        TCPSocket.connect(peer, () => {
            console.log('connecting')
            TCPSocket.write(handshake, (error) => {
                console.log('writed::', peer.host)
            })
        })
    }
}