declare module "qrcode" {
  const QRCode: {
    toBuffer: (text: string, opts?: { scale?: number }) => Promise<Buffer>
  }
  export default QRCode
}

