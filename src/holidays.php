<?php
// 日本の祝日の計算と、会社の休業日を含めた「営業日」の判定。
// 2000年〜2099年で使えます（2020・2021年の東京オリンピック特例にも対応）。

class Holidays
{
    /** @return array<string,string> 日付 => 祝日名 */
    public static function national(int $y): array
    {
        static $cache = [];
        if (isset($cache[$y])) {
            return $cache[$y];
        }
        $h = [];
        $add = function (int $m, int $d, string $name) use (&$h, $y) {
            $h[sprintf('%04d-%02d-%02d', $y, $m, $d)] = $name;
        };
        $mon = function (int $m, int $n) use ($y) { // 第n月曜
            $d = 1 + ((8 - (int)date('w', mktime(0, 0, 0, $m, 1, $y))) % 7) + 7 * ($n - 1);
            return $d;
        };

        $add(1, 1, '元日');
        $add(1, $mon(1, 2), '成人の日');
        $add(2, 11, '建国記念の日');
        if ($y >= 2020) {
            $add(2, 23, '天皇誕生日');
        }
        $add(3, self::vernal($y), '春分の日');
        $add(4, 29, '昭和の日');
        $add(5, 3, '憲法記念日');
        $add(5, 4, 'みどりの日');
        $add(5, 5, 'こどもの日');
        if ($y === 2020) {
            $add(7, 23, '海の日');
            $add(8, 10, '山の日');
            $add(7, 24, 'スポーツの日');
        } elseif ($y === 2021) {
            $add(7, 22, '海の日');
            $add(8, 8, '山の日');
            $add(7, 23, 'スポーツの日');
        } else {
            $add(7, $mon(7, 3), '海の日');
            $add(8, 11, '山の日');
            $add(10, $mon(10, 2), 'スポーツの日');
        }
        $add(9, $mon(9, 3), '敬老の日');
        $add(9, self::autumnal($y), '秋分の日');
        $add(11, 3, '文化の日');
        $add(11, 23, '勤労感謝の日');
        ksort($h);

        // 国民の休日（前後を祝日にはさまれた平日）
        $extra = [];
        foreach (array_keys($h) as $d) {
            $next = date('Y-m-d', strtotime($d . ' +2 day'));
            $mid = date('Y-m-d', strtotime($d . ' +1 day'));
            if (isset($h[$next]) && !isset($h[$mid]) && date('w', strtotime($mid)) != 0) {
                $extra[$mid] = '国民の休日';
            }
        }
        $h += $extra;
        ksort($h);

        // 振替休日（日曜が祝日なら、次の祝日でない日）
        $sub = [];
        foreach ($h as $d => $name) {
            if (date('w', strtotime($d)) == 0) {
                $n = date('Y-m-d', strtotime($d . ' +1 day'));
                while (isset($h[$n]) || isset($sub[$n])) {
                    $n = date('Y-m-d', strtotime($n . ' +1 day'));
                }
                $sub[$n] = '休日（振替休日）';
            }
        }
        $h += $sub;
        ksort($h);
        return $cache[$y] = $h;
    }

    private static function vernal(int $y): int
    {
        return (int)floor(20.8431 + 0.242194 * ($y - 1980) - floor(($y - 1980) / 4));
    }

    private static function autumnal(int $y): int
    {
        return (int)floor(23.2488 + 0.242194 * ($y - 1980) - floor(($y - 1980) / 4));
    }
}

/** 土日・祝日・会社の休業日を除いた「営業日」を扱う */
class BizCalendar
{
    /** @var array<string,string> */
    private $company;

    /** @param array<string,string> $company 会社の休業日（日付 => 名前） */
    public function __construct(array $company = [])
    {
        $this->company = $company;
    }

    public static function fromDb(): BizCalendar
    {
        $map = [];
        foreach (rows('SELECT hdate, name FROM company_holidays') as $r) {
            $map[$r['hdate']] = $r['name'];
        }
        return new BizCalendar($map);
    }

    public function holidayName(string $date): ?string
    {
        $nat = Holidays::national((int)substr($date, 0, 4));
        return $nat[$date] ?? ($this->company[$date] ?? null);
    }

    public function isBusinessDay(string $date): bool
    {
        $w = (int)date('w', strtotime($date));
        return $w !== 0 && $w !== 6 && $this->holidayName($date) === null;
    }

    public function shiftBack(string $date): string
    {
        for ($i = 0; $i < 31 && !$this->isBusinessDay($date); $i++) {
            $date = date('Y-m-d', strtotime($date . ' -1 day'));
        }
        return $date;
    }

    public function shiftForward(string $date): string
    {
        for ($i = 0; $i < 31 && !$this->isBusinessDay($date); $i++) {
            $date = date('Y-m-d', strtotime($date . ' +1 day'));
        }
        return $date;
    }
}
