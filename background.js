const baseURL = 'linkbox.artelin.dev'
const webProtocol = 'https'
const apiBaseURL = `${webProtocol}://${baseURL}`
const tokenRefreshBufferMs = 60 * 1000

const contextMenuItems = [
    {
        id: 'LinkBox',
        title: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'displayLinkBox',
        title: 'Display LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendAllTabsToLinkBox',
        title: 'Send all tabs to LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendWebLinkToLinkBox',
        title: 'Send this web link to LinkBox',
        parentId: 'LinkBox',
        contexts: ['link']
    },
    {
        id: 'separator1',
        type: 'separator',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendOnlyThisTabToLinkBox',
        title: 'Send only this tab to LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendAllTabsExceptThisTabToLinkBox',
        title: 'Send all tabs except this tab to LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendTabsOnTheLeftToLinkBox',
        title: 'Send tabs on the left to LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'sendTabsOnTheRightToLinkBox',
        title: 'Send tabs on the right to LinkBox',
        parentId: 'LinkBox',
        contexts: ['all']
    },
    {
        id: 'LogoutSeparator',
        type: 'separator',
        parentId: 'LinkBox',
        contexts: ['action']
    },
    {
        id: 'Logout',
        title: 'Logout',
        parentId: 'LinkBox',
        contexts: ['action']
    }
]

let loginPromise = null

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

function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon-large.png',
        title: title,
        message: message
    })
}

function parseJwtPayload(token) {
    if (!token) {
        return null
    }

    try {
        const tokenParts = token.split('.')
        if (tokenParts.length < 2) {
            return null
        }

        const normalizedPayload = tokenParts[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')

        return JSON.parse(atob(paddedPayload))
    } catch (error) {
        console.log('Failed to parse auth token payload', error)
        return null
    }
}

function isTokenFresh(token) {
    const payload = parseJwtPayload(token)
    if (!payload || !payload.exp) {
        return false
    }

    return (payload.exp * 1000) - Date.now() > tokenRefreshBufferMs
}

async function auth(openLogin = true) {
    const username = await getFromStorage('username')
    const password = await getFromStorage('password')

    if (!username || !password) {
        if (openLogin) {
            await createTab({ url: 'login.html' })
        }
        return false
    }

    return true
}

async function loginUser() {
    if (!(await auth())) {
        return null
    }

    const username = await getFromStorage('username')
    const password = await getFromStorage('password')

    try {
        const response = await fetch(`${apiBaseURL}/authenticate`, {
            method: 'post',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username, password: password })
        })
        const responseBody = await response.json()

        if (responseBody.success) {
            await setInStorage('authToken', responseBody.token)
            return responseBody.token
        }

        showNotification('Error', responseBody.message)
        return null
    } catch (error) {
        console.log('loginUser failed', error)
        showNotification('Error', 'LinkBox server is offline')
        return null
    }
}

async function ensureFreshAuthToken(forceRefresh = false) {
    if (!(await auth())) {
        return null
    }

    const authToken = await getFromStorage('authToken')
    if (!forceRefresh && isTokenFresh(authToken)) {
        return authToken
    }

    if (loginPromise) {
        return loginPromise
    }

    loginPromise = loginUser()
        .catch(error => {
            console.log('loginUser failed', error)
            return null
        })
        .finally(() => {
            loginPromise = null
        })

    return loginPromise
}

async function postWithAuth(path, body, allowRetry = true) {
    const authToken = await ensureFreshAuthToken()
    if (!authToken) {
        return null
    }

    try {
        const response = await fetch(`${apiBaseURL}${path}`, {
            method: 'post',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'authToken': authToken
            },
            body: JSON.stringify(body)
        })

        if (response.status === 401 && allowRetry) {
            const freshToken = await ensureFreshAuthToken(true)
            if (!freshToken) {
                return null
            }
            return postWithAuth(path, body, false)
        }

        let responseBody = null
        try {
            responseBody = await response.json()
        } catch (error) {
            responseBody = null
        }

        if (!response.ok || (responseBody && responseBody.success === false)) {
            showNotification('Error', responseBody && responseBody.message ? responseBody.message : `Request failed (${response.status})`)
            return null
        }

        return responseBody || { success: true }
    } catch (error) {
        console.log('postWithAuth failed', error)
        showNotification('Error', 'LinkBox server is offline')
        return null
    }
}

async function addLink(link) {
    return postWithAuth('/extension/add-link', link)
}

async function addLinks(links) {
    return postWithAuth('/extension/add-links', { links: links })
}

function isLinkBoxUrl(url = '') {
    return url.startsWith(apiBaseURL)
}

function isChromeUrl(url = '') {
    return /^chrome/i.test(url)
}

function isSavableTab(tab) {
    return Boolean(tab && typeof tab.id !== 'undefined' && tab.url && !isLinkBoxUrl(tab.url) && !isChromeUrl(tab.url))
}

function toLinkPayload(tab) {
    return {
        title: tab.title,
        link: tab.url
    }
}

function queryTabs(queryInfo) {
    return new Promise(resolve => {
        chrome.tabs.query(queryInfo, resolve)
    })
}

function createTab(createProperties) {
    return new Promise(resolve => {
        chrome.tabs.create(createProperties, resolve)
    })
}

function updateTab(tabId, updateProperties) {
    return new Promise(resolve => {
        chrome.tabs.update(tabId, updateProperties, resolve)
    })
}

function updateWindow(windowId, updateInfo) {
    return new Promise(resolve => {
        chrome.windows.update(windowId, updateInfo, resolve)
    })
}

function removeTabs(tabIds) {
    return new Promise(resolve => {
        chrome.tabs.remove(tabIds, () => resolve())
    })
}

function removeAllContextMenus() {
    return new Promise(resolve => {
        chrome.contextMenus.removeAll(() => resolve())
    })
}

function createContextMenu(createProperties) {
    return new Promise(resolve => {
        chrome.contextMenus.create(createProperties, () => resolve())
    })
}

async function initializeContextMenus() {
    await removeAllContextMenus()
    for (const item of contextMenuItems) {
        await createContextMenu(item)
    }
}

async function warmUpSession() {
    try {
        if (await auth(false)) {
            await ensureFreshAuthToken()
        }
    } catch (error) {
        console.log('warmUpSession failed', error)
    }
}

async function displayLinkBox() {
    const tabs = await queryTabs({})
    const linkBoxTab = tabs.find(tab => isLinkBoxUrl(tab.url))

    if (!linkBoxTab) {
        await createTab({ url: apiBaseURL })
        return
    }

    await updateTab(linkBoxTab.id, { active: true })
    await updateWindow(linkBoxTab.windowId, { focused: true })
}

async function openOrFocusLinkBoxTab(tabs) {
    const linkBoxTab = tabs.find(tab => isLinkBoxUrl(tab.url))

    if (!linkBoxTab) {
        const createdTab = await createTab({ url: apiBaseURL })
        return createdTab ? createdTab.id : null
    }

    await updateTab(linkBoxTab.id, { active: true })
    await updateWindow(linkBoxTab.windowId, { focused: true })
    return linkBoxTab.id
}

async function sendAllTabsToLinkBox() {
    if (!(await auth())) {
        return
    }

    const tabs = await queryTabs({ currentWindow: true })
    const savableTabs = tabs.filter(isSavableTab)

    if (savableTabs.length === 0) {
        return
    }

    await openOrFocusLinkBoxTab(tabs)

    const result = await addLinks(savableTabs.map(toLinkPayload))
    if (result) {
        await removeTabs(savableTabs.map(tab => tab.id))
    }
}

async function sendCurrentTabToLinkBox() {
    if (!(await auth())) {
        return
    }

    const tabs = await queryTabs({ currentWindow: true, active: true })
    const tab = tabs[0]

    if (!isSavableTab(tab)) {
        return
    }

    const currentWindowTabs = await queryTabs({ currentWindow: true })
    await openOrFocusLinkBoxTab(currentWindowTabs)

    const result = await addLink(toLinkPayload(tab))
    if (result) {
        await removeTabs(tab.id)
    }
}

async function sendAllTabsExceptCurrentTabToLinkBox() {
    if (!(await auth())) {
        return
    }

    const tabs = await queryTabs({ currentWindow: true })
    const savableTabs = tabs.filter(tab => !tab.active && isSavableTab(tab))

    if (savableTabs.length === 0) {
        return
    }

    await openOrFocusLinkBoxTab(tabs)

    const result = await addLinks(savableTabs.map(toLinkPayload))
    if (result) {
        await removeTabs(savableTabs.map(tab => tab.id))
    }
}

async function sendTabsOnTheLeftToLinkBox() {
    if (!(await auth())) {
        return
    }

    const tabs = await queryTabs({ currentWindow: true })
    const currentTabIndex = tabs.findIndex(tab => tab.active)
    const savableTabs = tabs.filter((tab, index) => index < currentTabIndex && isSavableTab(tab))

    if (savableTabs.length === 0) {
        return
    }

    await openOrFocusLinkBoxTab(tabs)

    const result = await addLinks(savableTabs.map(toLinkPayload))
    if (result) {
        await removeTabs(savableTabs.map(tab => tab.id))
    }
}

async function sendTabsOnTheRightToLinkBox() {
    if (!(await auth())) {
        return
    }

    const tabs = await queryTabs({ currentWindow: true })
    const currentTabIndex = tabs.findIndex(tab => tab.active)
    const savableTabs = tabs.filter((tab, index) => index > currentTabIndex && isSavableTab(tab))

    if (savableTabs.length === 0) {
        return
    }

    await openOrFocusLinkBoxTab(tabs)

    const result = await addLinks(savableTabs.map(toLinkPayload))
    if (result) {
        await removeTabs(savableTabs.map(tab => tab.id))
    }
}

async function sendWebLinkToLinkBox(info) {
    if (!(await auth())) {
        return
    }

    if (!info.linkUrl || isLinkBoxUrl(info.linkUrl) || isChromeUrl(info.linkUrl)) {
        return
    }

    await addLink({
        title: info.linkText || info.linkUrl,
        link: info.linkUrl
    })
}

async function handleTabChange() {
    const tabs = await queryTabs({ currentWindow: true })
    const currentTabIndex = tabs.findIndex(tab => tab.active)
    const savableTabs = tabs.filter(isSavableTab)

    chrome.contextMenus.update('sendAllTabsToLinkBox', { enabled: savableTabs.length > 0 })
    chrome.contextMenus.update('sendOnlyThisTabToLinkBox', { enabled: currentTabIndex !== -1 && isSavableTab(tabs[currentTabIndex]) })
    chrome.contextMenus.update('sendAllTabsExceptThisTabToLinkBox', { enabled: savableTabs.some(tab => !tab.active) })

    if (currentTabIndex === -1) {
        chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: false })
        chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: false })
        return
    }

    const hasSavableTabOnTheLeft = tabs.some((tab, index) => index < currentTabIndex && isSavableTab(tab))
    const hasSavableTabOnTheRight = tabs.some((tab, index) => index > currentTabIndex && isSavableTab(tab))

    chrome.contextMenus.update('sendTabsOnTheLeftToLinkBox', { enabled: hasSavableTabOnTheLeft })
    chrome.contextMenus.update('sendTabsOnTheRightToLinkBox', { enabled: hasSavableTabOnTheRight })
}

chrome.runtime.onInstalled.addListener(() => {
    void (async () => {
        await initializeContextMenus()
        await handleTabChange()
        await warmUpSession()
    })()
})

chrome.runtime.onStartup.addListener(() => {
    void (async () => {
        await handleTabChange()
        await warmUpSession()
    })()
})

chrome.commands.onCommand.addListener(command => {
    switch (command) {
        case 'display-linkbox':
            void displayLinkBox()
            break
        case 'send-current-tab-to-linkbox':
            void sendCurrentTabToLinkBox()
            break
        default:
            break
    }
})

chrome.action.onClicked.addListener(() => {
    void sendAllTabsToLinkBox()
})

chrome.tabs.onActivated.addListener(() => {
    void handleTabChange()
})

chrome.tabs.onMoved.addListener(() => {
    void handleTabChange()
})

chrome.tabs.onRemoved.addListener(() => {
    void handleTabChange()
})

chrome.tabs.onUpdated.addListener(() => {
    void handleTabChange()
})

chrome.runtime.onMessage.addListener(request => {
    if (request.message === 'loggedIn') {
        showNotification('Success', 'Logged in')
        void warmUpSession()
    }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case 'displayLinkBox':
            void displayLinkBox()
            break
        case 'sendAllTabsToLinkBox':
            void sendAllTabsToLinkBox()
            break
        case 'sendWebLinkToLinkBox':
            void sendWebLinkToLinkBox(info, tab)
            break
        case 'sendOnlyThisTabToLinkBox':
            void sendCurrentTabToLinkBox()
            break
        case 'sendAllTabsExceptThisTabToLinkBox':
            void sendAllTabsExceptCurrentTabToLinkBox()
            break
        case 'sendTabsOnTheLeftToLinkBox':
            void sendTabsOnTheLeftToLinkBox()
            break
        case 'sendTabsOnTheRightToLinkBox':
            void sendTabsOnTheRightToLinkBox()
            break
        case 'Logout':
            void (async () => {
                await clearStorage()
                showNotification('Success', 'Logged out')
            })()
            break
        default:
            break
    }
})
