import tooBusy from 'toobusy-js'

export function tooBusyCheck(req, res, next) {
    if (tooBusy()) {
        res.status(503).send('Server too busy')
    } else {
        next()
    }
}