"use strict";
/**
 * Micro artillery
 *
 * Defense loadout: artillery 3, shield/reflect 3, thrusters 1
 * Offense loadout: artillery 2, regen 3, thrusters 1, mine 1
 */
var update = function () {
    // Controls whether artillery attack without sensors
    var AGGRESSIVE = false;
    // Controls EWMA limits: these can be a bit higher than for missiles
    var TEAM_MIN_DIST = 3.5;
    var TEAM_MAX_DIST = 7;
    if (isAttacker) {
        attackerUpdateLocation(x, y);
        checkTeamCentroidMove(TEAM_MIN_DIST, TEAM_MAX_DIST);
    }
    // Do we see anything nearby?
    var closestEnemy = findEntity(ENEMY, ANYTHING, SORT_BY_DISTANCE, SORT_ASCENDING);
    if (!exists(closestEnemy)) {
        tryShieldFriendlyBots(4);
        // If we don't see anything and can activate sensors, go ahead.
        tryActivateSensors();
        // Sensors and still don't see anything?
        // Defenders can be more aggresive, attackers have mines.
        if (isAttacker) {
            // We have landmines, no more need to wait for sensors
            if (AGGRESSIVE)
                figureItOut();
            // But this is useful for dealing with other artillery
            else if (areSensorsActivated())
                figureItOut();
            // This is important to stop artillery from being effin slow
            else if (!canLayMine())
                figureItOut();
            else
                tryLayMine();
        }
        else {
            defenderMove(true);
        }
    }
    var closestEnemyBot = findEntity(ENEMY, BOT, SORT_BY_DISTANCE, SORT_ASCENDING);
    if (!exists(closestEnemyBot)) {
        tryShieldFriendlyBots(4);
        tryActivateSensors();
        if (isAttacker) {
            if (AGGRESSIVE)
                figureItOut();
            else if (areSensorsActivated())
                figureItOut();
            else if (!canLayMine())
                figureItOut();
            else
                tryLayMine();
        }
        else {
            defenderMove(true);
        }
    }
    // Now we know there's a bot nearby.
    setEnemySeen(closestEnemyBot);
    var allEnemyBots = findEntities(ENEMY, BOT, false);
    var numEnemyBots = size(allEnemyBots);
    var enemyBotDistance = getDistanceTo(closestEnemyBot);
    var allFriendlyBots = findEntities(IS_OWNED_BY_ME, BOT, true);
    var numFriendlyBots = size(allFriendlyBots);
    // Don't stand in range of lasers. On defense when there are lots of allies,
    // don't evade lasers though, just let the tanks reflect them. Welcome
    // lasers if we have mines.
    if (!canLayMine() && numFriendlyBots < 6)
        tryEvadeLasers(closestEnemyBot, numEnemyBots, 5);
    if (enemyBotDistance < 5.1) {
        tryReflect();
        if (!isShielded())
            tryShieldSelf();
        else
            tryShieldFriendlyBots(4);
    }
    // Not in melee range...can we shoot something if there aren't too many enemies around?
    // TODO add shared variable for retreating
    // TODO: if other artillery in range, don't stand still, zig zag
    // TODO only for attacker do we count the bots here
    // Need <= 1 or will keep shooting at far enemy even if getting attacked by
    // close enemy, and its better to mine. Can shoot if we're defending with
    // buddies
    if (numEnemyBots <= 1 || (!isAttacker && numFriendlyBots >= 5)) {
        tryFireArtillery();
    }
    // I think we can ignore all the above and always shoot, cause landmines
    // Should we even have this code up here?
    // Generally evade anything closer than 5. On defense we have tanks, on
    // attack we have mines.
    var evadeThreshold = 6.5;
    if (AGGRESSIVE)
        evadeThreshold = 4.5;
    // There's an enemy nearby but we can't attack it, or there are too many.
    // Artillery has min range 5, max range 7
    if (enemyBotDistance < evadeThreshold) {
        // This is reversed from missiles. Because artillery has no short range it
        // should definitely mine when enemies get close.
        if (enemyBotDistance < 3.1 && percentChance(80))
            tryLayMine();
        else if (enemyBotDistance <= 4.1 && percentChance(50))
            tryLayMine();
        // Try evasive maneuvers
        tryEvadeEnemy(closestEnemyBot, numEnemyBots);
        // Can't evade, just mine
        tryLayMine();
    }
    tryFireArtillery();
    tryActivateSensors();
    defaultMove(true);
};
/**
 * Utilities for bots to save data across turns about themselves. Enables crazy
 * things like the chaos zapper.
 *
 * This uses sharedD to store data, and sharedE to store corresponding entities
 * for that data.
 *
 * TODO: this will conflict with missile micro potshots, so we need to have that
 * use this system when merging.
 */
var saveData = function (datum) {
    var me = getEntityAt(x, y);
    if (!exists(sharedE)) {
        // We are the first person to save data, put ourselves in position 1
        array1 = [];
        array2 = [];
        array1[0] = datum;
        array2[0] = me;
        sharedD = array1;
        sharedE = array2;
        return;
    }
    // Load arrays from shared variables
    array1 = sharedD;
    array2 = sharedE;
    var i = 0;
    for (i = 0; i < size(array2); i++) {
        if (array2[i] == me) {
            // That's my data!
            array1[i] = datum;
            // No change to entity
            sharedD = array1;
            sharedE = array2;
            return;
        }
    }
    // We weren't in the array, insert ourselves at the end
    array1[i] = datum;
    array2[i] = me;
    debugLog('Saved ' + datum + ' for ' + me);
    debugLog(array2);
    debugLog(array1);
    sharedD = array1;
    sharedE = array2;
};
var getData = function () {
    // No data saved yet
    if (!exists(sharedE))
        return undefined;
    var me = getEntityAt(x, y);
    // Load arrays
    // debugLog("array1 before data load", array1);
    // debugLog("array2 before data load", array2);
    array1 = sharedD;
    array2 = sharedE;
    // debugLog("array1 after data load", array1);
    // debugLog("array2 after data load", array2);
    var i = 0;
    for (i = 0; i < size(array2); i++) {
        if (array2[i] == me) {
            // That's my data!
            return array1[i];
        }
    }
    // Data not found
    return undefined;
};
var isNumber = function (value) {
    if (value == value + 0)
        return true;
    else
        return false;
};
/**
 * Default moving function, to be called if a specific script has no opinion. We
 * use this in place of figureItOut() to avoid unwanted premature utility
 * activations. Assumes the script will generally deal with enemies if they get
 * in range.
 *
 * @param isArtillery if artillery, will not move <5 units from target.
 */
var defaultMove = function (isArtillery) {
    // React to enemy structures
    var closestEnemyChip = findEntity(ENEMY, CHIP, SORT_BY_DISTANCE, SORT_ASCENDING);
    if (exists(closestEnemyChip)) {
        if (canMoveTo(closestEnemyChip) && getDistanceTo(closestEnemyChip) > 1)
            pursue(closestEnemyChip);
    }
    // Bots come after structures, if the script didn't react to it already
    var closestEnemyBot = findEntity(ENEMY, BOT, SORT_BY_DISTANCE, SORT_ASCENDING);
    if (exists(closestEnemyBot)) {
        var dist = getDistanceTo(closestEnemyBot);
        if (canMoveTo(closestEnemyBot) && dist > 1) {
            if (isArtillery && dist <= 5)
                return;
            pursue(closestEnemyBot);
        }
    }
    // CPU comes last
    var enemyCpu = findEntity(ENEMY, CPU, SORT_BY_DISTANCE, SORT_ASCENDING);
    if (exists(enemyCpu)) {
        if (canMoveTo(enemyCpu) && getDistanceTo(enemyCpu) > 1) {
            pursue(enemyCpu);
        }
    }
    // If we don't see anything, take a look around
    if (canActivateSensors())
        activateSensors();
    // TODO: do not pursue enemy bots > 5 away (?)
    // Need to modify figureItOut for this
    // Where to go?
    if (isAttacker) {
        var cpuX = arenaWidth - 1;
        var cpuY = floor(arenaHeight / 2);
        if (isArtillery && getDistanceTo(cpuX, cpuY) <= 5)
            return;
        moveTo(cpuX, cpuY);
    }
    else {
        defenderMove(isArtillery);
    }
};
/**
 * Attacker movement code works as follows:
 *
 * shared(A, B) records the centroid of the team. It is updated using a hacky
 * exponentially-weighted moving average. Certain units update and respond to
 * this EWMA (microing bots), while others just respond to it but don't update
 * (repair bots).
 *
 * For bots that care about being near the group, the further away they are from
 * this centroid the more they will be likely to move toward it.
 */
var attackerUpdateLocation = function (xCoord, yCoord) {
    if (!isAttacker)
        return;
    // All bots update a shared counter, so by looking at it since our last turn
    // we know how many bots are alive, hence the weight to update the EWMA.
    // Increment the shared counter. 4 is a reasonable starting weight because
    // that's how many bots we often have.
    var DEFAULT_STARTING_BOTS = 4;
    if (!exists(sharedC))
        sharedC = DEFAULT_STARTING_BOTS - 1;
    sharedC = sharedC + 1;
    var myCounter = getData();
    if (!isNumber(myCounter))
        myCounter = sharedC - DEFAULT_STARTING_BOTS;
    saveData(sharedC);
    // TODO bots seem to be updated in a random order. But that's okay, if it
    // nets out to the right average.
    var numFriendsAlive = sharedC - myCounter;
    debugLog('I see ' + numFriendsAlive + ' friends alive');
    // First turn update
    if (!exists(sharedA)) {
        sharedA = xCoord;
        sharedB = yCoord;
        return;
    }
    var alpha = 1.0 / numFriendsAlive;
    sharedA = xCoord * alpha + sharedA * (1 - alpha);
    sharedB = yCoord * alpha + sharedB * (1 - alpha);
};
var checkTeamCentroidMove = function (minDist, maxDist) {
    if (!isAttacker)
        return;
    // Distances in bot land are manhattan distance
    var distToCentroid = abs(x - sharedA) + abs(y - sharedB);
    debugLog('My ', x, y, ' is ', distToCentroid, ' from the center', sharedA, sharedB);
    debugLog('Limits: ', minDist, maxDist);
    // If within minDist of centroid it's good. Beyond maxDist of centroid 100%
    // move toward centroid. Linear in between.
    var forceMoveProbability = (distToCentroid - minDist) / (maxDist - minDist);
    var forceMoveChance = min(100, max(0, 100 * forceMoveProbability));
    debugLog('Moving to centroid with probability', forceMoveChance);
    if (percentChance(forceMoveChance))
        moveTo(round(sharedA), round(sharedB));
};
/**
 * We have seen some baddies. Setting this causes other bots to move accordingly
 * to the enemy's location.
 * @param enemy
 */
var setEnemySeen = function (enemy) {
    // This is only used for defenders, at the moment, so avoid clobbering the
    // shared variables that are currently used by attackers.
    if (isAttacker)
        return;
    // We store 2 locations (see README). Bots attack to whichever location is
    // closest to them, until cleared. Note that we are forced to use these
    // weird array1 and array2 variables to index into arrays.
    // Record 1st location if we don't already have one.
    loadArr1Loc1();
    if (size(array1) == 0) {
        array1 = [];
        array1[0] = enemy.x;
        array1[1] = enemy.y;
        saveArr1Loc1();
        return;
    }
    var locOneDiff = abs(enemy.x - array1[0]) + abs(enemy.y - array1[1]);
    // If it's sufficiently close, count it as the same "area" and just
    // update.
    if (locOneDiff < 6) {
        array1 = [];
        array1[0] = enemy.x;
        array1[1] = enemy.y;
        saveArr1Loc1();
        return;
    }
    // This seems like a different location. Do we have something recorded for location 2?
    loadArr2Loc2();
    if (size(array2) == 0) {
        array2 = [];
        array2[0] = enemy.x;
        array2[1] = enemy.y;
        saveArr2Loc2();
        return;
    }
    var locTwoDiff = abs(enemy.x - array2[0]) + abs(enemy.y - array2[1]);
    if (locTwoDiff < 8) {
        array2 = [];
        array2[0] = enemy.x;
        array2[1] = enemy.y;
        saveArr2Loc2();
        return;
    }
    // Shouldn't get here, but if so you're on your own...
};
// We'll just use array1 and array2 when working with the two locations so that
// there is no hope of confusing them. Note that crazy stuff can happen here
// since these variables can be overwritten in function calls.
var saveArr1Loc1 = function () {
    debugLog('enemy target 1 set at (' + array1[0] + ',' + array1[1] + ')');
    sharedA = array1;
};
var saveArr2Loc2 = function () {
    debugLog('enemy target 2 set at (' + array2[0] + ',' + array2[1] + ')');
    sharedB = array2;
};
// We cannot set an array to undefined, that causes a bug. So return empty array
// instead.
var loadArr1Loc1 = function () {
    if (!exists(sharedA))
        array1 = [];
    else
        array1 = sharedA;
};
var loadArr2Loc2 = function () {
    if (!exists(sharedB))
        array2 = [];
    else
        array2 = sharedB;
};
var clearLoc1 = function () {
    debugLog('enemy target 1 clear');
    array1 = [];
    sharedA = array1;
};
var clearLoc2 = function () {
    debugLog('enemy target 2 clear');
    array2 = [];
    sharedB = array2;
};
/**
 * If we don't see anyone, move to the closer of the two enemy locations, if
 * they exist. If we are close to one of the locations and no one's there,
 * specify that it is clear.
 *
 * @param isArtillery
 */
var defenderMove = function (isArtillery) {
    var cpuX = arenaWidth - 2;
    var cpuY = floor(arenaHeight / 2);
    loadArr1Loc1();
    loadArr2Loc2();
    // If we're all balled up near the CPU, there's enough of us, and no one sees any
    // enemies, go out and investigate the chips and see if they're okay.
    if (size(array1) == 0 && size(array2) == 0 && getDistanceTo(cpuX, cpuY) <= 1) {
        var allFriends = findEntitiesInRange(IS_OWNED_BY_ME, BOT, true, 3);
        var numFriends = size(allFriends);
        if (numFriends >= 6) {
            // XXX These are the locations of my chips in the level 3 defense
            array1 = [];
            array1[0] = cpuX - 4;
            array1[1] = cpuY - 3;
            saveArr1Loc1();
            array2 = [];
            array2[0] = cpuX - 4;
            array2[1] = cpuY + 3;
            saveArr2Loc2();
        }
    }
    // Check if we're close to either of the known enemy locations, and if we
    // don't see anyone there (with sensors) clear it.
    // TODO: artillery should be able to clear targets too.
    if (size(array1) > 0 && getDistanceTo(array1[0], array1[1]) <= 1) {
        tryActivateSensors();
        if (areSensorsActivated())
            clearLoc1();
    }
    if (size(array2) > 0 && getDistanceTo(array2[0], array2[1]) <= 1) {
        tryActivateSensors();
        if (areSensorsActivated())
            clearLoc2();
    }
    // Default size(array1) == 0 && size(array2) == 0
    var targetX = cpuX;
    var targetY = cpuY;
    // Figure out where we're moving.
    if (size(array1) > 0 && size(array2) === 0) {
        targetX = array1[0];
        targetY = array1[1];
    }
    if (size(array2) > 0 && size(array1) === 0) {
        targetX = array2[0];
        targetY = array2[1];
    }
    if (size(array1) > 0 && size(array2) > 0) {
        // Both locations exist, attack to the closest one.
        var dist1 = getDistanceTo(array1[0], array1[1]);
        var dist2 = getDistanceTo(array2[0], array2[1]);
        if (dist1 < dist2 || (dist1 == dist2 && percentChance(50))) {
            targetX = array1[0];
            targetY = array1[1];
        }
        else {
            targetX = array2[0];
            targetY = array2[1];
        }
    }
    // Artillery should not get too close.
    if (isArtillery && getDistanceTo(targetX, targetY) <= 5)
        return;
    moveTo(targetX, targetY);
};
/**
 * Tries to avoid being on the same horizontal/vertical as another nearby enemy
 * bot, in case they happen to be armed with a laser.
 * @param closestEnemyBot entity representing the closest bot we see
 * @param numEnemyBots total number of enemy bots visible
 */
var tryEvadeLasers = function (closestEnemyBot, numEnemyBots, weaponMaxRange) {
    var enemyBotDistance = getDistanceTo(closestEnemyBot);
    // Mainly for artillery. Lasers have a max range of 5, so why dodge them at
    // longer ranges? This occasionally helped with dodging artillery, but we
    // should write separate code for that.
    if (enemyBotDistance > 5)
        return;
    // Don't stand in range of lasers
    // Move away from the bot, preferably toward a border
    if (x == closestEnemyBot.x && enemyBotDistance > 1) {
        // TODO hack for fixing the bouncing back and forth issue at maximum
        // weapon range. This helps us get on a diagonal but still in range.
        if (enemyBotDistance == weaponMaxRange && percentChance(50)) {
            if (y > closestEnemyBot.y && canMove('up'))
                move('up');
            else if (y < closestEnemyBot.y && canMove('down'))
                move('down');
        }
        if (canMove('backward'))
            move('backward');
        if (canMove('forward') && numEnemyBots <= 1)
            move('forward');
    }
    if (y == closestEnemyBot.y && enemyBotDistance > 1) {
        // Move up or down randomly if both directions are available
        if (canMove('up') && canMove('down')) {
            if (percentChance(50))
                move('up');
            move('down');
        }
        if (canMove('up'))
            move('up');
        if (canMove('down'))
            move('down');
    }
};
/**
 * This micros a bot away from a target enemy, attempting to stay at a diagonal
 * distance.
 * @param closestEnemyBot
 * @param numEnemyBots
 */
var tryEvadeEnemy = function (closestEnemyBot, numEnemyBots) {
    // We're diagonally positioned from the enemy. Go in the direction with more space.
    // Prefer going backward to going forward, which can get us stuck.
    // TODO don't always run down from top left
    if (canMove('backward') && x <= closestEnemyBot.x) {
        // Do occasional diagonal moves to get people to eat mines
        if (y < closestEnemyBot.y && canMove('up') && percentChance(30))
            move('up');
        if (y > closestEnemyBot.y && canMove('down') && percentChance(30))
            move('down');
        move('backward');
    }
    // TODO we should move backward when there's one bot too
    // clean this code up
    if (canMove('up') && y <= closestEnemyBot.y) {
        move('up');
    }
    if (canMove('down') && y >= closestEnemyBot.y) {
        move('down');
    }
    if (canMove('backward')) {
        if (numEnemyBots > 1)
            move('backward');
    }
    if (canMove('forward') && x >= closestEnemyBot.x && numEnemyBots <= 1) {
        move('forward');
    }
    if (canMove('backward')) {
        move('backward');
    }
};
/**
 * Smart melee. This will try to hit the bot with lowest health nearby if it is
 * in melee range. It not hit a structure if an enemy bot is nearby, so if you
 * want to do that, call melee() manually.
 */
var tryMeleeSmart = function () {
    if (willMeleeHit()) {
        var gank = findEntity(ENEMY, BOT, SORT_BY_LIFE, SORT_ASCENDING);
        // Try a charge-hit first before a normal hit. I'm not sure about the
        // semantics of how willMeleeHit() works, so just being a bit extra
        // careful.
        if (getDistanceTo(gank) <= 2 && canCharge() && willMeleeHit(gank))
            melee(gank);
        else if (getDistanceTo(gank) <= 1)
            melee(gank);
        // If we can't hit our target of choice, we'll still hit a close by bot
        // (not chip or CPU)
        var close = findEntity(ENEMY, BOT, SORT_BY_DISTANCE, SORT_ASCENDING);
        if (getDistanceTo(close) <= 2 && canCharge() && willMeleeHit(close))
            melee(close);
        else if (getDistanceTo(close) <= 1)
            melee(close);
    }
};
/**
 * A smart missile firing function that shoots at the enemy bot that is visible
 * with lowest health, if it is in range.
 */
var tryFireMissiles = function () {
    if (willMissilesHit()) {
        var gank = findEntity(ENEMY, BOT, SORT_BY_LIFE, SORT_ASCENDING);
        if (willMissilesHit(gank))
            fireMissiles(gank);
        // If not, fire at anyone
        fireMissiles();
    }
};
var tryFireArtillery = function () {
    if (willArtilleryHit()) {
        var gank = findEntity(ENEMY, BOT, SORT_BY_LIFE, SORT_ASCENDING);
        if (willArtilleryHit(gank))
            fireArtillery(gank);
        fireArtillery();
    }
};
var tryActivateSensors = function () {
    // Sensors last 3 turns and have 6 cooldown, so don't need to count turns
    // like we could with a shield.
    if (canActivateSensors())
        activateSensors();
};
var tryCloak = function () {
    if (canCloak())
        cloak();
};
var tryLayMine = function () {
    if (canLayMine())
        layMine();
};
var tryReflect = function () {
    if (canReflect())
        reflect();
};
var tryShieldSelf = function () {
    // TODO: we could wait longer if we have a shield already. But it could be
    // damaged so maybe better to refresh.
    if (canShield())
        shield();
};
/**
 * Try shielding any allies within a certain range. This allows us to share
 * cooldown between bots.
 * @param range
 */
var tryShieldFriendlyBots = function (range) {
    if (canShield()) {
        // Try a few options.
        // First, lowest health
        tryShieldFriend(findEntity(IS_OWNED_BY_ME, BOT, SORT_BY_LIFE, SORT_ASCENDING));
        // Closest
        tryShieldFriend(findEntity(IS_OWNED_BY_ME, BOT, SORT_BY_DISTANCE, SORT_ASCENDING));
        // Anyone else? Shield 3 has a range of 5.
        array1 = findEntitiesInRange(IS_OWNED_BY_ME, BOT, false, range);
        for (var i = 0; i < size(array1); i++) {
            tryShieldFriend(array1[i]);
        }
    }
};
var tryShieldFriend = function (friend) {
    // Not sure if canShield checks our shield range...
    if (!isShielded(friend) && canShield(friend))
        shield(friend);
};
var tryTeleport = function (xCoord, yCoord) {
    if (canTeleport(xCoord, yCoord))
        teleport(xCoord, yCoord);
};
var tryZap = function () {
    if (canZap())
        zap();
};
