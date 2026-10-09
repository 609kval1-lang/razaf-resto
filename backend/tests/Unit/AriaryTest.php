<?php

namespace Tests\Unit;

use App\Support\Ariary;
use PHPUnit\Framework\TestCase;

class AriaryTest extends TestCase
{
    public function test_rounding_is_half_up_and_whole_amounts_are_not_changed(): void
    {
        $this->assertSame(15.0, Ariary::round(0.145 * 100));
        $this->assertSame(2.0, Ariary::round(0.003 * 500));
        $this->assertSame(14.0, Ariary::round(14.49));
        $this->assertSame(-15.0, Ariary::round(-14.5));
        $this->assertSame(1251.0, Ariary::requireWhole('1251.00'));
        $this->assertSame(0.0, Ariary::requireWhole(0));
    }

    public function test_allocated_lines_always_add_up_to_the_actual_amount(): void
    {
        foreach ([1, 2, 3, 99, 5400, 9900] as $amount) {
            foreach ([[1, 1, 1], [10000, 1000], [0, 1, 99], [10, 0, 0]] as $weights) {
                $allocated = Ariary::allocate($amount, $weights);
                $this->assertSame($amount, array_sum($allocated));
                foreach ($allocated as $key => $share) {
                    $this->assertGreaterThanOrEqual(0, $share);
                    $this->assertLessThanOrEqual(1.0, abs($share - $amount * $weights[$key] / array_sum($weights)));
                }
            }
        }
        $this->assertSame(['meal' => 4909, 'packaging' => 491], Ariary::allocate(5400, ['meal' => 10000, 'packaging' => 1000]));
        $this->assertSame([0, 0], Ariary::allocate(100, [0, 0]));
    }
}
