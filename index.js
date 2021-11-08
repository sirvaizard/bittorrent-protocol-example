import crypto from 'crypto'
import fs from 'fs/promises'
import dgram from 'dgram'
import { Buffer } from 'buffer'
import { URL } from 'url'
import bencode from 'bencode'

const CONNECT = 0
const ANNOUNCE = 1
const SCRAPE = 2
const ERROR = 3

const torrentFilename = 'big-buck-bunny.torrent'
const torrentFile = await fs.readFile(torrentFilename)

const torrent = bencode.decode(torrentFile, 'utf8')
const torrentInfo = bencode.encode(torrent.info)
const infoHash = crypto.createHash('sha1').update(torrentInfo).digest()

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
    for (const [key, value] of Object.entries(rinfo)) {
        console.log(`[rinfo-${key}]: ${value}`)
    }

    const response = Buffer.from(msg)
    const action = response.readUInt32BE(0)
    const transactionId = response.readUInt32BE(4)
    
    console.log(`Action: ${action}`)
    console.log(`TransactionId: ${transactionId}`)

    switch (action) {
        case CONNECT:
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
            break

        case SCRAPE:
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
            break
        
        case ERROR:
            console.log('Error')
    }
})

// O announce padrão não estava me retornando resposta, então peguei
// o primeiro da announce-list que me retornou algo.
const announce = torrent['announce-list'][2][0]
const url = new URL(announce)
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