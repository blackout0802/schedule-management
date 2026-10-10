<?php
// 変更履歴（管理者用）。誰が・いつ・何を変えたかを残す。
//
//   予定の追加・変更・削除（休み・業務）／繰り返し業務のルール／社員の追加・変更・パスワードのリセット／
//   会社の休業日／共有リンクの作成・停止／Slack通知の設定／パスワードの変更
//
// 残さないもの: プライベートの予定（管理者にも見せない約束のため、件名も日時も記録しない）、ToDo、日報メモ、ログインの記録。
// 記録に失敗しても、本来の操作は止めない。1年たった記録は、自動で消える。

const AUDIT_KEEP_DAYS = 365;

const AUDIT_TYPES = [
    'event' => '予定', 'series' => '繰り返し業務', 'user' => '社員', 'holiday' => '休業日',
    'share' => '共有リンク', 'slack' => 'Slack通知', 'security' => 'セキュリティ',
];
const AUDIT_ACTIONS = ['add' => '追加', 'update' => '変更', 'delete' => '削除', 'reset' => 'リセット'];

/** この操作をしている人（api.php が、ログインを確認したあとにセットする）。cron などでは null（システム） */
function audit_set_actor(?array $user): void
{
    $GLOBALS['AUDIT_ACTOR'] = $user ? ['id' => (int)$user['id'], 'name' => (string)$user['name']] : null;
}

function audit_actor(): array
{
    $a = $GLOBALS['AUDIT_ACTOR'] ?? null;
    return $a ?: ['id' => null, 'name' => '（システム）'];
}

/** 記録する。失敗しても、例外は出さない */
function audit_log(string $type, string $action, string $label, string $target = '', string $detail = ''): void
{
    try {
        $a = audit_actor();
        q('INSERT INTO audit_log (at, actor_id, actor_name, type, action, label, target_name, detail) VALUES (?,?,?,?,?,?,?,?)', [
            now_str(), $a['id'], mb_substr($a['name'], 0, 60), $type, $action, mb_substr($label, 0, 200), mb_substr($target, 0, 60), mb_substr($detail, 0, 500),
        ]);
        if (random_int(1, 40) === 1) {
            q('DELETE FROM audit_log WHERE at < ?', [date('Y-m-d H:i:s', time() - AUDIT_KEEP_DAYS * 86400)]);
        }
    } catch (Throwable $t) {
        error_log('[schedule] 変更履歴の記録に失敗: ' . $t->getMessage());
    }
}

function audit_md(string $d): string
{
    return (int)substr($d, 5, 2) . '/' . (int)substr($d, 8, 2);
}

function audit_event_label(array $e): string
{
    $span = $e['start_date'] === $e['end_date'] ? audit_md($e['start_date']) : audit_md($e['start_date']) . '〜' . audit_md($e['end_date']);
    $name = $e['kind'] === 'off' ? (($e['tag'] !== '' ? $e['tag'] : '休み') . ((string)$e['title'] !== '' ? '（' . $e['title'] . '）' : '')) : $e['title'];
    return ($e['kind'] === 'off' ? '休み｜' : '業務｜') . $name . '　' . $span;
}

/** 変更前後の違い（管理者向けなので、種類・分類も含める） */
function audit_event_detail(array $b, array $a): string
{
    $kn = ['work' => '業務', 'off' => '休み', 'private' => 'プライベート'];
    $p = [];
    if ($b['kind'] !== $a['kind']) {
        $p[] = '種類 ' . $kn[$b['kind']] . ' → ' . $kn[$a['kind']];
    }
    if ($b['title'] !== $a['title']) {
        $p[] = '件名「' . $b['title'] . '」→「' . $a['title'] . '」';
    }
    if ($b['tag'] !== $a['tag']) {
        $p[] = '分類 ' . ($b['tag'] !== '' ? $b['tag'] : '（なし）') . ' → ' . ($a['tag'] !== '' ? $a['tag'] : '（なし）');
    }
    if ($b['start_date'] !== $a['start_date'] || $b['end_date'] !== $a['end_date']) {
        $f = function ($x) { return $x['start_date'] === $x['end_date'] ? audit_md($x['start_date']) : audit_md($x['start_date']) . '〜' . audit_md($x['end_date']); };
        $p[] = '日付 ' . $f($b) . ' → ' . $f($a);
    }
    if ($b['start_time'] !== $a['start_time'] || $b['end_time'] !== $a['end_time']) {
        $t = function ($x) { return $x['start_time'] === '' && $x['end_time'] === '' ? '時刻なし' : $x['start_time'] . ($x['end_time'] !== '' ? '〜' . $x['end_time'] : ''); };
        $p[] = '時刻 ' . $t($b) . ' → ' . $t($a);
    }
    if ($b['note'] !== $a['note']) {
        $p[] = 'メモを更新';
    }
    if ((int)($b['important'] ?? 0) !== (int)($a['important'] ?? 0)) {
        $p[] = (int)$a['important'] === 1 ? '重要にした' : '重要を外した';
    }
    return implode('／', $p);
}

/** 予定の追加・変更・削除を記録する（event_changed から呼ぶ）。プライベートの予定は、記録しない */
function audit_event_change(?array $before, ?array $after): void
{
    $bp = $before !== null && $before['kind'] === 'private';
    $ap = $after !== null && $after['kind'] === 'private';
    if (($before === null || $bp) && ($after === null || $ap)) {
        return; // プライベートだけの出入り
    }
    $ref = $before !== null && !$bp ? $before : $after; // 件名は、プライベートでない側のものだけを使う
    $owner = row('SELECT name FROM users WHERE id = ?', [$ref['owner_id']]);
    if ($before === null) {
        audit_log('event', 'add', audit_event_label($after), $owner ? $owner['name'] : '');
    } elseif ($after === null) {
        audit_log('event', 'delete', audit_event_label($before), $owner ? $owner['name'] : '');
    } elseif ($bp || $ap) { // プライベートとの行き来（プライベートの側の内容は、出さない）
        audit_log('event', 'update', audit_event_label($bp ? $after : $before), $owner ? $owner['name'] : '', $bp ? 'プライベートから、全員に見える予定に変更' : '全員に見える予定から、プライベートに変更');
    } else {
        $d = audit_event_detail($before, $after);
        if ($d !== '') {
            audit_log('event', 'update', audit_event_label($after), $owner ? $owner['name'] : '', $d);
        }
    }
}

/**
 * 履歴を、新しい順に返す。
 * @param array{type?:string,actor?:int,q?:string,before?:int,limit?:int} $f
 * @return array{entries:array<int,array<string,mixed>>,has_more:bool}
 */
function audit_list(array $f): array
{
    $where = [];
    $params = [];
    if (!empty($f['type']) && isset(AUDIT_TYPES[$f['type']])) {
        $where[] = 'type = ?';
        $params[] = $f['type'];
    }
    if (!empty($f['actor'])) {
        $where[] = 'actor_id = ?';
        $params[] = (int)$f['actor'];
    }
    if (!empty($f['before'])) {
        $where[] = 'id < ?';
        $params[] = (int)$f['before'];
    }
    $q = trim((string)($f['q'] ?? ''));
    if ($q !== '') {
        $like = '%' . str_replace(['|', '%', '_'], ['||', '|%', '|_'], mb_substr($q, 0, 50)) . '%'; // | を、LIKE の目印（ESCAPE）にする（MySQL と SQLite で同じに動く）
        $where[] = "(label LIKE ? ESCAPE '|' OR detail LIKE ? ESCAPE '|' OR target_name LIKE ? ESCAPE '|' OR actor_name LIKE ? ESCAPE '|')";
        array_push($params, $like, $like, $like, $like);
    }
    $limit = max(1, min(100, (int)($f['limit'] ?? 50)));
    $rows = rows('SELECT * FROM audit_log' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY id DESC LIMIT ' . ($limit + 1), $params);
    $more = count($rows) > $limit;
    $rows = array_slice($rows, 0, $limit);
    return [
        'has_more' => $more,
        'entries' => array_map(function ($r) {
            return ['id' => (int)$r['id'], 'at' => $r['at'], 'actor_id' => $r['actor_id'] !== null ? (int)$r['actor_id'] : null, 'actor' => $r['actor_name'],
                'type' => $r['type'], 'type_name' => AUDIT_TYPES[$r['type']] ?? $r['type'], 'action' => $r['action'], 'action_name' => AUDIT_ACTIONS[$r['action']] ?? $r['action'],
                'label' => $r['label'], 'target' => $r['target_name'], 'detail' => $r['detail']];
        }, $rows),
    ];
}
