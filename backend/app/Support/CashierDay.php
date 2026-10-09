<?php

namespace App\Support;

final class CashierDay
{
    public const TIMEZONE = 'Indian/Antananarivo';

    public static function bounds(): array
    {
        $start = now(self::TIMEZONE)->startOfDay();
        $storageTimezone = config('app.timezone', 'UTC');

        return [
            $start->copy()->setTimezone($storageTimezone),
            $start->copy()->addDay()->setTimezone($storageTimezone),
        ];
    }
}
