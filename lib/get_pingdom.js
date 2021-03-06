'use strict';
var async = require('async');
var pingdom = require('pingdom-api');

module.exports = function(auth) {
    var client = pingdom(auth);

    return function(o, cb) {
        client.checks(function(err, checks) {
            if(err) {
                return cb(err);
            }

            async.parallel(constructChecks(client, o, checks), function(err, data) {
                if(err) {
                    return cb(err);
                }

                cb(null, structure(data));
            });
        });
    }
};

function constructChecks(client, o, checks) {
    return checks.map(function(check) {
        return function(cb) {
            var from = o.from;
            var to = o.to;

            async.series([
                getSummaries.bind(undefined, client, check, from, to),
                getDowntimes.bind(undefined, client, check, from, to)
            ], function(err, data) {
                if(err) {
                    return console.error(err);
                }

                cb(err, {
                    summaries: data[0],
                    downtimes: data[1]
                });
            });
        };
    });
}

function getSummaries(client, check, from, to, cb) {
    // downtime info is in seconds, not accurate enough...
    client['summary.performance'](function(err, data) {
        cb(err, {
            check: check,
            data: data
        }); // skip res
    }, {
        target: check.id,
        qs: {
            from: from,
            to: to,
            resolution: 'day'
        }
    });
}

function getDowntimes(client, check, from, to, cb) {
    client['summary.outage'](function(err, outages) {
        // skip res
        cb(err, outages && outages.states? calculateDowntimes(outages.states, from, to): []);
    }, {
        target: check.id,
        qs: {
            from: from,
            to: to
        }
    });
}

function calculateDowntimes(data, from, to) {
    var ret = zeroes(from.getDaysBetween(to));
    var downFrom, downTo, fromDelta, toDelta, next;

    // calculate downtimes per day and sum them up as ms
    data.filter(equals('status', 'down')).forEach(function(v) {
        downFrom = new Date(v.timefrom * 1000);
        downTo = new Date(v.timeto * 1000);
        fromDelta = from.getDaysBetween(downFrom);
        toDelta = from.getDaysBetween(downTo);

        if(fromDelta === toDelta) {
            ret[fromDelta] += downTo - downFrom;
        }
        else {
            next = downTo.clone().clearTime();

            ret[fromDelta] += next - downFrom;
            ret[toDelta] += downTo - next;
        }
    });

    return ret;
}

function structure(data) {
    var days = data[0].summaries.data.days;

    return {
        providers: data.map(function(d) {
            var summaries = d.summaries;
            var check = summaries.check;

            if(check.name.split(' ').length > 1 && check.name.indexOf('dd') !== 0) {
                return {
                    name: check.name,
                    host: check.hostname,
                    type: check.name.split(' ')[1].toLowerCase(),
                    latency: parseLatency(summaries.data.days),
                    downtime: d.downtimes
                };
            }
        }).filter(id),
        firstDate: days[0].starttime,
        lastDate: days[days.length - 1].starttime
    };

    function parseLatency(data) {
        return data.map(function(v) {
            return v.avgresponse;
        });
    }
}

// TODO: move to some utility lib
function zeroes(a) {
    var ret = [];
    var i;

    for(i = 0; i < a; i++) {
        ret.push(0);
    }

    return ret;
}

// TODO: move to some utility lib
function equals(a, b) {
    return function(v) {
        return v[a] === b;
    };
}

function id(a) {return a;}
