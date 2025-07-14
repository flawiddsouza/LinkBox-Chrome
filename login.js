const baseURL = 'https://linkbox.artelin.dev'

var username = document.getElementById('username')
var password = document.getElementById('password')
var loginButton = document.getElementById('loginButton')

var messageBox = document.querySelector('.message')
var messageBody = document.querySelector('.message-body')

loginButton.addEventListener('click', e => {
    e.preventDefault()
    fetch(`${baseURL}/authenticate`, {
        method: 'post',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: username.value, password: password.value })
    })
    .then(res => res.json())
    .then(res => {
        if(res.success) {
            chrome.storage.local.set({
                authToken: res.token,
                username: username.value,
                password: password.value
            }, () => {
                chrome.runtime.sendMessage({ message: 'loggedIn'})
                chrome.tabs.getCurrent(tab => chrome.tabs.remove(tab.id))
            })
        } else {
            messageBody.innerHTML = res.message
            messageBox.style.display = 'block'
        }
    })
})