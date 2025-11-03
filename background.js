import { ReconnectingWebSocket } from './reconnecting-websocket.js'

const baseURL = 'linkbox.artelin.dev'
const socketProtocol = 'wss'
const webProtocol = 'https'

const ws = new ReconnectingWebSocket(`${socketProtocol}://${baseURL}`)

auth()

function isStorageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
}

async function getFromStorage(key) {
    if (!isStorageAvailable()) {
        throw new Error('chrome.storage.local is not available in this context.')
    }
    return (await chrome.storage.local.get([key]))[key]
}
async function setInStorage(key, value) {
    if (!isStorageAvailable()) {
        throw new Error('chrome.storage.local is not available in this context.')
    }
    await chrome.storage.local.set({ [key]: value })
}
async function clearStorage() {
    if (!isStorageAvailable()) {
        throw new Error('chrome.storage.local is not available in this context.')
    }
    await chrome.storage.local.clear()
}

let linksAddedWhileOffline = []
;(async () => {
    try {
        const storedLinks = await getFromStorage('linksAddedWhileOffline')
        if (storedLinks) {
            linksAddedWhileOffline = JSON.parse(storedLinks)
        } else {
            await setInStorage('linksAddedWhileOffline', JSON.stringify(linksAddedWhileOffline))
        }
    } catch (err) {
        console.error('Storage error:', err)
    }
})()

// Store pending tab closures waiting for confirmation
const pendingTabClosures = new Map()

ws.addEventListener('message', e => {
    try {
        var receivedJSON = JSON.parse(e.data)
        var event = receivedJSON.event
        var payload = receivedJSON.payload
        if(event) {
            switch(event) {
                case 'need-valid-token':
                    onNeedValidToken(payload)
                    break
                case 'link-added':
                case 'links-added':
                    onLinksAdded(payload)
                    break
            }
        }
    } catch(err) {
        if(err instanceof SyntaxError) {
            console.log('Invalid JSON received:', e.data)
        } else {
            console.log(err)
        }
    }
})

function onLinksAdded(payload) {
    // When we get confirmation that links were added, close the tabs
    if (payload && payload.requestId && pendingTabClosures.has(payload.requestId)) {
        const tabIds = pendingTabClosures.get(payload.requestId)
        chrome.tabs.remove(tabIds)
        pendingTabClosures.delete(payload.requestId)
    }
}

function onNeedValidToken(payload) {
    if(payload) {
        loginUser(() => wsSendJSON(payload))
    } else {
        loginUser()
    }
}

async function wsSendJSON(obj) {
    if (ws.readyState === WebSocket.OPEN) {
        const authToken = await getFromStorage('authToken')
        Object.assign(obj, { authToken: authToken }) // attach authToken to the send
        // Generate a unique request ID for tracking confirmations
        if (!obj.requestId && (obj.method === 'add-link' || obj.method === 'add-links')) {
            obj.requestId = `${Date.now()}-${Math.random()}`
        }
        ws.send(JSON.stringify(obj))
        return obj.requestId
    } else {
        console.log('wsSendJSON failed because WebSocket is not open')
        return null
    }
}

function addLink(title, link) {
    return wsSendJSON({ method: 'add-link', payload: { title: title, link: link } })
}

function addLinks(linkArray) {
    return wsSendJSON({ method: 'add-links', payload: linkArray })
}

async function addLinksWhileOffline(links) {
    linksAddedWhileOffline.push(links)
    await setInStorage('linksAddedWhileOffline', JSON.stringify(linksAddedWhileOffline))
}

async function auth(openLogin = true) {
    const username = await getFromStorage('username')
    const password = await getFromStorage('password')

    if (!username || !password) {
        if (openLogin) {
            chrome.tabs.create({ url: 'login.html' })
        }
        return false
    } else {
        return true
    }
}

async function loginUser(callback = null) {
    if (!(await auth())) {
        return
    }
    const username = await getFromStorage('username')
    const password = await getFromStorage('password')

    fetch(`${webProtocol}://${baseURL}/authenticate`, {
        method: 'post',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: username, password: password })
    })
    .then(res => res.json())
    .then(async res => {
        if (res.success) {
            await setInStorage('authToken', res.token)
            if (callback) {
                callback()
            }
        } else {
            this.authError = res.message
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: res.message
            })
        }
    })
}

function displayLinkBox() {
    var hasLinkBox = false
    var linkBoxTabId = null
    var linkBoxWindowId = null
    chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
            if(RegExp(`${baseURL}.*`).test(tab.url)) {
                hasLinkBox = true
                linkBoxTabId = tab.id
                linkBoxWindowId = tab.windowId
            }
        })
        if(!hasLinkBox) { // open tab only if LinkBox isn't open in any tab
            chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
        } else { // set focus to the LinkBox tab
            chrome.tabs.update(linkBoxTabId, { active: true })
            chrome.windows.update(linkBoxWindowId, { focused: true })
        }
    })
}

function sendAllTabsToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true }, async tabs => {
        var links = []
        var tabIds = []
        var hasLinkBox = false
        var linkBoxTabId = null

        tabs.forEach(tab => {
            if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
                links.push({ title: tab.title, link: tab.url })
                tabIds.push(tab.id)
            }
            if(RegExp(`${baseURL}.*`).test(tab.url)) {
                hasLinkBox = true
                linkBoxTabId = tab.id
            }
        })

        if(ws.readyState === WebSocket.OPEN) {
            // Open LinkBox first to prevent closing the window
            if(!hasLinkBox) {
                const linkBoxTab = await chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
                linkBoxTabId = linkBoxTab.id
            } else {
                // Set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
            
            // Send links and store tab IDs for later closure upon confirmation
            const requestId = await addLinks(links)
            if (requestId && tabIds.length > 0) {
                pendingTabClosures.set(requestId, tabIds)
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: 'LinkBox server is offline'
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log('WebSocket is in state CONNECTING or CLOSING')
        }
    })
}

function sendCurrentTabToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true, active: true }, async tabs => {
        var tab = tabs[0]
        var link = {}

        if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
            link = { title: tab.title, link: tab.url }
        } else {
            return
        }

        if(ws.readyState === WebSocket.OPEN) {
            // Send link and store tab ID for later closure upon confirmation
            const requestId = await addLink(link.title, link.link)
            if (requestId) {
                pendingTabClosures.set(requestId, [tab.id])
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: 'LinkBox server is offline'
            })
            // addLinksWhileOffline([link])
            // chrome.tabs.remove(tab.id)
        } else {
            console.log('WebSocket is in state CONNECTING or CLOSING')
        }
    })
}

function sendAllTabsExceptCurrentTabToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true }, async tabs => {
        var links = []
        var tabIds = []
        var hasLinkBox = false
        var linkBoxTabId = null

        tabs.forEach(tab => {
            if(!tab.active) {
                if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
                    links.push({ title: tab.title, link: tab.url })
                    tabIds.push(tab.id)
                }
            }
            if(RegExp(`${baseURL}.*`).test(tab.url)) {
                hasLinkBox = true
                linkBoxTabId = tab.id
            }
        })

        if(ws.readyState === WebSocket.OPEN) {
            // Open LinkBox first to prevent closing the window
            if(!hasLinkBox) {
                const linkBoxTab = await chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
                linkBoxTabId = linkBoxTab.id
            } else {
                // Set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
            
            // Send links and store tab IDs for later closure upon confirmation
            const requestId = await addLinks(links)
            if (requestId && tabIds.length > 0) {
                pendingTabClosures.set(requestId, tabIds)
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: 'LinkBox server is offline'
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log('WebSocket is in state CONNECTING or CLOSING')
        }
    })
}

function sendTabsOnTheLeftToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true }, async tabs => {
        var links = []
        var tabIds = []
        var hasLinkBox = false
        var linkBoxTabId = null

        var currentTabIndex = null
        tabs.forEach((tab, index) => {
            if(tab.active) {
                currentTabIndex = index
            }
        })

        tabs.forEach((tab, index) => {
            if(index < currentTabIndex) {
                if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
                    links.push({ title: tab.title, link: tab.url })
                    tabIds.push(tab.id)
                }
            }
            if(RegExp(`${baseURL}.*`).test(tab.url)) {
                hasLinkBox = true
                linkBoxTabId = tab.id
            }
        })

        if(ws.readyState === WebSocket.OPEN) {
            // Open LinkBox first to prevent closing the window
            if(!hasLinkBox) {
                const linkBoxTab = await chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
                linkBoxTabId = linkBoxTab.id
            } else {
                // Set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
            
            // Send links and store tab IDs for later closure upon confirmation
            const requestId = await addLinks(links)
            if (requestId && tabIds.length > 0) {
                pendingTabClosures.set(requestId, tabIds)
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: 'LinkBox server is offline'
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log('WebSocket is in state CONNECTING or CLOSING')
        }
    })
}

function sendTabsOnTheRightToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true }, async tabs => {
        var links = []
        var tabIds = []
        var hasLinkBox = false
        var linkBoxTabId = null

        var currentTabIndex = null
        tabs.forEach((tab, index) => {
            if(tab.active) {
                currentTabIndex = index
            }
        })

        tabs.forEach((tab, index) => {
            if(index > currentTabIndex) {
                if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
                    links.push({ title: tab.title, link: tab.url })
                    tabIds.push(tab.id)
                }
            }
            if(RegExp(`${baseURL}.*`).test(tab.url)) {
                hasLinkBox = true
                linkBoxTabId = tab.id
            }
        })

        if(ws.readyState === WebSocket.OPEN) {
            // Open LinkBox first to prevent closing the window
            if(!hasLinkBox) {
                const linkBoxTab = await chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
                linkBoxTabId = linkBoxTab.id
            } else {
                // Set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
            
            // Send links and store tab IDs for later closure upon confirmation
            const requestId = await addLinks(links)
            if (requestId && tabIds.length > 0) {
                pendingTabClosures.set(requestId, tabIds)
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: 'LinkBox server is offline'
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log('WebSocket is in state CONNECTING or CLOSING')
        }
    })
}

function handleTabChange() {
    chrome.tabs.query({ currentWindow: true }, tabs => {
        if(tabs.length == 1) {
            chrome.contextMenus.update('sendAllTabsExceptThisTabToLinkBox', { enabled: false })
            chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: false })
            chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: false })
            if(RegExp(`${baseURL}.*`).test(tabs[0].url) || RegExp(/^chrome.*/).test(tabs[0].url)) {
                chrome.contextMenus.update('sendAllTabsToLinkBox', { enabled: false })
                chrome.contextMenus.update('sendOnlyThisTabToLinkBox', { enabled: false })
            } else {
                chrome.contextMenus.update('sendAllTabsToLinkBox', { enabled: true })
                chrome.contextMenus.update('sendOnlyThisTabToLinkBox', { enabled: true })
            }
        } else {
            chrome.contextMenus.update('sendAllTabsExceptThisTabToLinkBox', { enabled: true })
            chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: true })
            chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: true })
        }
        var currentTabIndex = null
        var tabOnLeft = false
        var tabOnRight = false
        tabs.forEach((tab, index) => {
            if(tab.active) {
                currentTabIndex = index
            }
        })
        if(currentTabIndex) {
            tabs.forEach((tab, index) => {
                if(index === currentTabIndex - 1) {
                    tabOnLeft = true
                    // console.log('There\'s a tab on the left')
                }
                if(index === currentTabIndex + 1) {
                    tabOnRight = true
                    // console.log('There\'s a tab on the right')
                }
            })
            if(!tabOnLeft) {
                chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: false })
            } else {
                chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: true })
            }
            if(!tabOnRight) {
                chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: false })
            } else {
                chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: true })
            }
        }
    })
}

async function setupLogoutContextMenu() {
    chrome.contextMenus.create({
        id: 'LogoutSeparator',
        type: 'separator',
        parentId: 'LinkBox',
        contexts: ['action']
    })

    chrome.contextMenus.create({
        id: 'Logout',
        title: 'Logout',
        parentId: 'LinkBox',
        contexts: ['action']
    })
}

function removeLogoutContextMenus() {
    chrome.contextMenus.remove('LogoutSeparator')
    chrome.contextMenus.remove('Logout')
}

chrome.commands.onCommand.addListener(command => {
    switch(command) {
        case 'display-linkbox':
            displayLinkBox()
            break
        case 'send-current-tab-to-linkbox':
            sendCurrentTabToLinkBox()
            break
    }
})

chrome.action.onClicked.addListener(activeTab => sendAllTabsToLinkBox())

chrome.contextMenus.removeAll()

chrome.contextMenus.create({
    id: 'LinkBox',
    title: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'displayLinkBox',
    title: 'Display LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendAllTabsToLinkBox',
    title: 'Send all tabs to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendWebLinkToLinkBox',
    title: 'Send this web link to LinkBox',
    parentId: 'LinkBox',
    contexts: ['link']
})

chrome.contextMenus.create({
    id: 'separator1',
    type: 'separator',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendOnlyThisTabToLinkBox',
    title: 'Send only this tab to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendAllTabsExceptThisTabToLinkBox',
    title: 'Send all tabs except this tab to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendTabsOnTheLeftToLinkBox',
    title: 'Send tabs on the left to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendTabsOnTheRightToLinkBox',
    title: 'Send tabs on the right to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all']
})

if(auth(false)) {
    setupLogoutContextMenu()
}

chrome.tabs.onActivated.addListener(activeInfo => handleTabChange())
chrome.tabs.onMoved.addListener(tabId => handleTabChange())
chrome.tabs.onRemoved.addListener(tabId => handleTabChange())

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.message == 'loggedIn') {
        chrome.notifications.create({
            type : 'basic',
            iconUrl: 'icon-large.png',
            title: 'Success',
            message: 'Logged in'
        })

        setupLogoutContextMenu()
    }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case 'displayLinkBox':
            displayLinkBox()
            break
        case 'sendAllTabsToLinkBox':
            sendAllTabsToLinkBox()
            break
        case 'sendWebLinkToLinkBox':
            console.log(info)
            break
        case 'sendOnlyThisTabToLinkBox':
            sendCurrentTabToLinkBox()
            break
        case 'sendAllTabsExceptThisTabToLinkBox':
            sendAllTabsExceptCurrentTabToLinkBox()
            break
        case 'sendTabsOnTheLeftToLinkBox':
            sendTabsOnTheLeftToLinkBox()
            break
        case 'sendTabsOnTheRightToLinkBox':
            sendTabsOnTheRightToLinkBox()
            break
        case 'Logout':
            (async () => {
                await clearStorage()
                chrome.notifications.create({
                    type : 'basic',
                    iconUrl: 'icon-large.png',
                    title: 'Success',
                    message: 'Logged out'
                })
                removeLogoutContextMenus()
            })()
            break
        default:
            break
    }
})
