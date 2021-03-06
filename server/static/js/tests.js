
/* global module, test */
/* global ok, equal, deepEqual */
/* global sinon */
/* global Ui */

// A mock server for socket.io.
function Server() {
    console.log('init server');
    var self = {
        received: [],
        handlers: {}
    };

    self.socket = {
        on: function(type, handler) {
            self.handlers[type] = handler;
        },
        emit: function(type, data) {
            console.debug('receive', type, data);
            self.received.push({type: type, data: data});
        }
    };

    self.send = function(type, data) {
        data = data || {};
        console.debug('send', type, data);
        ok(self.handlers[type], 'expecting event handler for message '+type);
        self.handlers[type](data);
    };

    self.receive = function() {
        return self.received.shift();
    };

    self.expect = function(type, data) {
        var message = self.receive();
        ok(message, 'expecting a message: '+type);
        if (message) {
            equal(message.type, type, type);
            deepEqual(message.data, data, data);
        }
    };

    self.no_messages = function() {
        ok(self.received.length === 0, 'not expecting any messages');
    };

    return self;
}

function find(sel) {
    return $('#qunit-fixture').find(sel);
}

function invisible(sel) {
    ok(!find(sel).is(':visible'), sel+' shouldn\'t be visible');
}

function visible(sel) {
    ok(find(sel).is(':visible'), sel+' should be visible');
}

function disabled(sel) {
    ok(!find(sel).is(':enabled'), sel+' shouldn\'t be enabled');
}

function enabled(sel) {
    ok(find(sel).is(':enabled'), sel+' should be enabled');
}

function tiles(sel, expected_tile_codes) {
    var tile_codes = $.map(find(sel).find('.tile'), function(tile) { return $(tile).data('tile'); });
    deepEqual(tile_codes, expected_tile_codes, 'expected specific tiles at '+sel);
}

var ui, server, clock;

function setup_test() {
    window.location.hash = "";

    server = Server();
    ui = Ui($('#qunit-fixture .main.ui'), server.socket);
    ui.discard_time_limit = 30 * 1000;
    ui.hand_time_limit = 3 * 60 * 1000;
    ui.testing = true;

    clock = sinon.useFakeTimers();
}

function teardown_test() {
    clock.restore();
}

module(
    'login stage',
    {
        setup: setup_test,
        teardown: teardown_test
    });

test('initialize', function() {
    ok(true);
});

test('log in', function() {
    ui.find('input[name=nick]').val('Akagi');
    ui.find('.new-game').click();
    server.expect('new_game', 'Akagi');

    // TODO this actually disregards joining game and just assumes server will
    // assign a game immediately

    server.send('room', {'key': 'K',
                         'nicks': ['Akagi', 'Washizu'],
                         'you': 1});

    server.send('phase_one', {
        tiles: ['X1', 'X2', 'X3'],
        dora_ind: 'X3',
        east: 0,
        you: 1,
    });

    tiles('.dora-display', ['X3']);
    tiles('.tiles', ['X1', 'X2', 'X3']);
    visible('.nicks');
    equal(ui.find('.nicks .you').text(), 'Washizu');
    equal(ui.find('.nicks .opponent').text(), 'Akagi');
});


module(
    'phase one',
    {
        setup: function() {
            setup_test();
            ui.test_phase_1();
        },
        teardown: teardown_test
    });

test('submit hand', function() {
    for (var i = 0; i < 13; i++) {
        disabled('.submit-hand');
        ui.find('.tiles .tile').first().click();
    }
    enabled('.submit-hand');

    // TODO try removing (possibly split this test case?)

    ui.find('.submit-hand').click();
    invisible('.submit-hand');

    // TODO try removing again
    server.expect('hand', ['M1', 'M1', 'M2', 'M2', 'M3', 'M3',
                           'P1', 'P1', 'P2', 'P2', 'P3', 'P3',
                           'S1']);

    server.send('wait_for_phase_two');
    server.send('phase_two');
});

test('display clock while selecting hand', function() {
    server.send('clock', {time_limit: 3*60});
    visible('.clock');
    equal(ui.find('.clock').text(), '3:00');

    clock.tick(15*1000);
    equal(ui.find('.clock').text(), '2:45');
    for (var i = 0; i < 13; i++)
        ui.find('.tiles .tile').click();
    ui.find('.submit-hand').click();
    server.send('wait_for_phase_two');
    server.send('clock', {time_limit: null});
    invisible('.clock');
});

test('auto-submit hand on timeout', function() {
    server.send('clock', {time_limit: 3*60});
    visible('.clock');
    clock.tick(3*60*1000);
    server.expect('hand', ['M1', 'M1', 'M2', 'M2', 'M3', 'M3',
                           'P1', 'P1', 'P2', 'P2', 'P3', 'P3',
                           'S1']);
});

module(
    'phase two',
    {
        setup: function() {
            setup_test();
            ui.test_phase_2();
        },
        teardown: teardown_test
    });

test('deal when allowed', function() {
    server.send('your_move');
    equal(ui.table.state, null);
    clock.tick(ui.discard_delay);
    equal(ui.table.state, 'discard');

    ui.find('.tiles .tile').first().click();
    tiles('.discards', ['S1']);
    server.expect('discard', 'S1');
    equal(ui.table.state, null);

    server.send('discarded', {player: 0, tile: 'S1'});
});

test('show clock while dealing', function() {
    invisible('.clock');
    server.send('your_move');
    server.send('clock', {time_limit: 30});
    invisible('.clock'); // display clock only after delay
    clock.tick(ui.discard_delay);

    visible('.clock');
    equal(ui.find('.clock').text(), '0:29');

    clock.tick(14*1000);
    equal(ui.find('.clock').text(), '0:15');

    ui.find('.tiles .tile').first().click();
    server.send('clock', {time_limit: null});
    invisible('.clock');
});

test('auto-deal on timeout', function() {
    server.send('your_move');
    server.send('clock', {time_limit: 30});
    clock.tick(ui.discard_delay);
    visible('.clock');

    clock.tick(30*1000 - ui.discard_delay);
    invisible('.clock');
    server.expect('discard', 'S1');
});

test('show riichi stick after first discard', function() {
    server.send('your_move');
    clock.tick(ui.discard_delay);

    invisible('.stick');
    invisible('.opponent-stick');

    ui.find('.tiles .tile').first().click();
    server.send('discarded', {player: 0, tile: 'S1'});
    visible('.stick');
    invisible('.opponent-stick');

    server.send('discarded', {player: 1, tile: 'S1'});
    visible('.stick');
    visible('.opponent-stick');
});

test('not deal when not allowed', function() {
    equal(ui.table.state, null);

    ui.find('.tiles .tile').first().click();
    tiles('.discards', []);
    server.no_messages();
});

test('display opponent discards', function() {
    tiles('.opponent-discards', []);
    server.send('discarded', {player: 1, tile: 'S1'});
    tiles('.opponent-discards', ['S1']);
});

test('end game by draw', function() {
    server.send('draw');
    invisible('.end-draw');
    clock.tick(ui.discard_delay);
    visible('.end-draw');
});

test('abort game', function() {
    server.send('abort', {culprit: 1, description: 'Something happened'});
    visible('.overlay');
    ok(ui.find('.status-text').text().indexOf('Something happened') != -1,
       'status bar should contain message');
});

var RON_DATA = {
    player: 0,
    hand: ['S1', 'S1', 'S2', 'S3', 'S4'],
    yaku: ['ban tan', 'tao tao'],
    yakuman: false,
    dora: 3,
    uradora_ind: 'X1',
    points: 7
};

test('win game', function() {
    server.send('discarded', {player: 1, tile: 'S1'});
    server.send('ron', RON_DATA);
    invisible('.end-ron');
    clock.tick(ui.discard_delay);
    visible('.end-ron');
    equal(ui.find('.end-ron .message').text(), 'You won!');
    // winning tile should be displayed next to the hand
    tiles('.end-ron .winning-hand', ['S1', 'S2', 'S3', 'S4', 'S1']);
    // M1 is dora indicator from Ui.test_phase_1
    tiles('.end-ron .doras-ind', ['M1', RON_DATA.uradora_ind]);
    ok(/riichi/.test(ui.find('.end-ron .yaku').text()));
    ok(/ban tan/.test(ui.find('.end-ron .yaku').text()));
    ok(/tao tao/.test(ui.find('.end-ron .yaku').text()));
    ok(/dora 3/.test(ui.find('.end-ron .yaku').text()));
    equal(ui.find('.end-ron .points').text(), '7');
});

test('win game with yakuman', function() {
    server.send('discarded', {player: 0, tile: 'S1'});
    server.send('ron', {
        player: 1,
        hand: ['S1', 'S1', 'S2', 'S3', 'S4'],
        yaku: ['rising sun'],
        yakuman: true,
        dora: 3,
        uradora_ind: 'X1',
        points: 42
    });
    clock.tick(ui.discard_delay);
    ok(/rising sun/.test(ui.find('.end-ron .yaku').text()));
    ok(!/dora/.test(ui.find('.end-ron .yaku').text()), "shouldn't list dora");
    ok(!/riichi/.test(ui.find('.end-ron .yaku').text()), "shouldn't list riichi");
});
