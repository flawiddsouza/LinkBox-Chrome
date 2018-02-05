const baseURL = '128.199.204.21:9886'
const socketProtocol = 'ws'
const webProtocol = 'http'

const ws = new ReconnectingWebSocket(`${socketProtocol}://${baseURL}`)

auth()

var linksAddedWhileOffline = []

if(localStorage.getItem('linksAddedWhileOffline')) {
    linksAddedWhileOffline = JSON.parse(localStorage.getItem('linksAddedWhileOffline'))
} else {
    localStorage.setItem('linksAddedWhileOffline', JSON.stringify(linksAddedWhileOffline))
}

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

function onNeedValidToken(payload) {
    if(payload) {
        loginUser(() => wsSendJSON(payload))
    } else {
        loginUser()
    }
}

function wsSendJSON(obj) {
    if(ws.readyState === WebSocket.OPEN) {
        var authToken = localStorage.getItem('authToken')
        Object.assign(obj, { authToken: authToken }) // attach authToken to the send
        ws.send(JSON.stringify(obj))
    } else {
        console.log('wsSendJSON failed because WebSocket is not open')
    }
}

function addLink(title, link) {
    wsSendJSON({ method: 'add-link', payload: { title: title, link: link } })
}

function addLinks(linkArray) {
    wsSendJSON({ method: 'add-links', payload: linkArray })
}

function addLinksWhileOffline(links) {
    linksAddedWhileOffline.push(links)
    localStorage.setItem('linksAddedWhileOffline', JSON.stringify(linksAddedWhileOffline))
}

function auth(openLogin = true) {
    var username = localStorage.getItem('username')
    var password = localStorage.getItem('password')

    if(!username || !password) {
        if(openLogin) {
            chrome.tabs.create({ url: 'login.html' })
        }
        return false
    } else {
        return true
    }
}

function loginUser(callback = null) {
    if(!auth()) {
        return
    }

    var username = localStorage.getItem('username')
    var password = localStorage.getItem('password')

    fetch(`${webProtocol}://${baseURL}/authenticate`, {
        method: 'post',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: username, password: password })
    })
    .then(res => res.json())
    .then(res => {
        if(res.success) {
            localStorage.setItem('authToken', res.token)
            if(callback) {
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

    chrome.tabs.getAllInWindow(null, tabs => {
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
            addLinks(links)
            chrome.tabs.remove(tabIds)
            if(!hasLinkBox) { // open tab only if LinkBox isn't open in any tab
                chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
            } else { // set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: "LinkBox server is offline"
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log("WebSocket is in state CONNECTING or CLOSING")
        }
    })
}

function sendCurrentTabToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.query({ currentWindow: true, active: true }, tabs => {
        var tab = tabs[0]
        var link = {}

        if(!RegExp(`${baseURL}.*`).test(tab.url) && !RegExp(/^chrome.*/).test(tab.url)) { // we avoid adding & closing LinkBox if it's open in the window
            link = { title: tab.title, link: tab.url }
        } else {
            return
        }

        if(ws.readyState === WebSocket.OPEN) {
            addLink(link.title, link.link)
            chrome.tabs.remove(tab.id)
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: "LinkBox server is offline"
            })
            // addLinksWhileOffline([link])
            // chrome.tabs.remove(tab.id)
        } else {
            console.log("WebSocket is in state CONNECTING or CLOSING")
        }
    })
}

function sendAllTabsExceptCurrentTabToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.getAllInWindow(null, tabs => {
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
            addLinks(links)
            chrome.tabs.remove(tabIds)
            if(!hasLinkBox) { // open tab only if LinkBox isn't open in any tab
                chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
            } else { // set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: "LinkBox server is offline"
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log("WebSocket is in state CONNECTING or CLOSING")
        }
    })
}

function sendTabsOnTheLeftToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.getAllInWindow(null, tabs => {
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
            addLinks(links)
            chrome.tabs.remove(tabIds)
            if(!hasLinkBox) { // open tab only if LinkBox isn't open in any tab
                chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
            } else { // set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: "LinkBox server is offline"
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log("WebSocket is in state CONNECTING or CLOSING")
        }
    })
}

function sendTabsOnTheRightToLinkBox() {
    if(!auth()) {
        return
    }

    chrome.tabs.getAllInWindow(null, tabs => {
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
            addLinks(links)
            chrome.tabs.remove(tabIds)
            if(!hasLinkBox) { // open tab only if LinkBox isn't open in any tab
                chrome.tabs.create({ url: `${webProtocol}://${baseURL}` })
            } else { // set focus to the LinkBox tab
                chrome.tabs.update(linkBoxTabId, { active: true })
            }
        } else if(ws.readyState === WebSocket.CLOSED) {
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Error',
                message: "LinkBox server is offline"
            })
            // addLinksWhileOffline(links)
            // chrome.tabs.remove(tabIds)
        } else {
            console.log("WebSocket is in state CONNECTING or CLOSING")
        }
    })
}

function handleTabChange() {
    chrome.tabs.getAllInWindow(null, tabs => {
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
                    // console.log("There's a tab on the left")
                }
                if(index === currentTabIndex + 1) {
                    tabOnRight = true
                    // console.log("There's a tab on the right")
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

function setupLogoutContextMenu() {
    chrome.contextMenus.create({
        id: 'LogoutSeparator',
        type: 'separator',
        parentId: 'LinkBox',
        contexts: ['browser_action']
    })

    chrome.contextMenus.create({
        id: 'Logout',
        title: 'Logout',
        parentId: 'LinkBox',
        contexts: ['browser_action'],
        onclick: info => {
            localStorage.clear()
            chrome.notifications.create({
                type : 'basic',
                iconUrl: 'icon-large.png',
                title: 'Success',
                message: "Logged out"
            })
            removeLogoutContextMenus()
        }
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

chrome.browserAction.onClicked.addListener(activeTab => sendAllTabsToLinkBox())

chrome.contextMenus.removeAll()

chrome.contextMenus.create({
    id: 'LinkBox',
    title: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    title: 'Display LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: () => {
        displayLinkBox()
    }
})

chrome.contextMenus.create({
    id: 'sendAllTabsToLinkBox',
    title: 'Send all tabs to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: () => {
        sendAllTabsToLinkBox()
    }
})

chrome.contextMenus.create({
    title: 'Send this web link to LinkBox',
    parentId: 'LinkBox',
    contexts: ['link'],
    onclick: info => {
        console.log(info)
    }
})

chrome.contextMenus.create({
    type: 'separator',
    parentId: 'LinkBox',
    contexts: ['all']
})

chrome.contextMenus.create({
    id: 'sendOnlyThisTabToLinkBox',
    title: 'Send only this tab to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: info => {
        sendCurrentTabToLinkBox()
    }
})

chrome.contextMenus.create({
    id: 'sendAllTabsExceptThisTabToLinkBox',
    title: 'Send all tabs except this tab to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: info => {
        sendAllTabsExceptCurrentTabToLinkBox()
    }
})

chrome.contextMenus.create({
    id: 'sendTabsOnTheLeftToLinkBox',
    title: 'Send tabs on the left to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: info => {
        sendTabsOnTheLeftToLinkBox()
    }
})

chrome.contextMenus.create({
    id: 'sendTabsOnTheRightToLinkBox',
    title: 'Send tabs on the right to LinkBox',
    parentId: 'LinkBox',
    contexts: ['all'],
    onclick: info => {
        sendTabsOnTheRightToLinkBox()
    }
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
            message: "Logged in"
        })

        setupLogoutContextMenu()
    }
})