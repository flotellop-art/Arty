import { registerPlugin } from '@capacitor/core'

// Shared proxy, including the cold bridge: no private session import here.
const plugin = registerPlugin('MailImap')
export const getMailImapPlugin = <T>() => plugin as T
